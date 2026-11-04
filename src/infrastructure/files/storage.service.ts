import { forbidden, badRequest } from "../../shared/errors.ts";
import type { FileConfirmResult, FilePresignResult } from "../../shared/types.ts";
import { randomId, sha256 } from "../../shared/utils.ts";
import { ApplicationDatabase } from "../database/application-database.ts";
import type { PersistentFileStore } from "./persistent-file-store.ts";

/**
 * StorageService models the documented presign -> confirm -> download authorization flow.
 */
export class StorageService {
  private readonly maxFileSizeBytes = 20 * 1024 * 1024;

  constructor(private readonly database: ApplicationDatabase) {}

  private activeOwner<T>(owner:{appId:string;userId:string},fn:()=>Promise<T>){
    return this.database.withAppUserDataTransaction(owner.appId,owner.userId,async()=>{
      const member=await this.database.findAppUser(owner.appId,owner.userId),user=await this.database.findUserById(owner.userId);
      if(member?.status!=='ACTIVE'||user?.status!=='ACTIVE')forbidden('FILE_ACCESS_DENIED','The source file owner is no longer active.');
      return fn();
    });
  }
  async storeOwnerText(store: PersistentFileStore, owner: {appId:string;userId:string}, name: string, content: string, identity: string) {
    if (!name.trim() || name.length > 200 || !content.trim() || Buffer.byteLength(content) > 80000)
      badRequest("REQ_INVALID_BODY", "Source text must be nonempty UTF-8 within 80000 bytes.");
    const storageKey = `files/${owner.appId}/sources/${sha256(JSON.stringify([owner.userId,identity]))}.txt`;
    try{
      const existing=await this.activeOwner(owner,async()=>{
        const file=await this.database.findFileByOwnerAndStorageKey(owner.appId,owner.userId,storageKey);
        if(!file)await this.database.insertFile({id:'db_file_'+sha256(storageKey),appId:owner.appId,ownerUserId:owner.userId,storageKey,mimeType:'text/plain',sizeBytes:Buffer.byteLength(content),status:'PENDING',createdAt:new Date().toISOString()});return file;
      });
      if(existing?.status==='CONFIRMED'){
        if(await store.readBoundedText(storageKey,80000)!==content)badRequest('REQ_INVALID_BODY','File request identity belongs to another immutable body.');
        await this.activeOwner(owner,async()=>{});
      }else{
        await store.writeText(storageKey,content);
        await this.activeOwner(owner,async()=>{
          if(!await this.database.findFileByOwnerAndStorageKey(owner.appId,owner.userId,storageKey))forbidden('FILE_ACCESS_DENIED','Source metadata was removed; the late upload is discarded.');
          await this.confirmUpload({appId:owner.appId,ownerUserId:owner.userId,storageKey,mimeType:'text/plain',sizeBytes:Buffer.byteLength(content)});
        });
      }
      return {storage_key:storageKey,file_name:name,size_bytes:Buffer.byteLength(content)};
    }catch(error){
      const member=await this.database.findAppUser(owner.appId,owner.userId);
      if(!member||member.status==='DELETED')await this.database.enqueueFilePurge(owner.appId,owner.userId,storageKey);
      throw error;
    }
  }
  async readOwnerText(store: PersistentFileStore, owner: {appId:string;userId:string}, storageKey: string) {
    const file=await this.database.findFileByOwnerAndStorageKey(owner.appId,owner.userId,storageKey);
    if(!file||file.status!=="CONFIRMED"||!["text/plain","text/markdown"].includes(file.mimeType)||file.sizeBytes>80000||!storageKey.startsWith(`files/${owner.appId}/`))
      forbidden("FILE_ACCESS_DENIED","Confirmed owner text file is required.");
    return store.readBoundedText(storageKey,80000);
  }

  async presignUpload(command: {
    appId: string;
    ownerUserId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<FilePresignResult> {
    if (command.sizeBytes <= 0 || command.sizeBytes > this.maxFileSizeBytes) {
      badRequest("REQ_INVALID_BODY", "File size is outside the allowed range.");
    }

    const storageKey = `files/${command.appId}/${new Date().toISOString().slice(0, 10)}/${randomId(
      "file",
    )}-${command.fileName}`;

    await this.database.insertFile({
      id: randomId("db_file"),
      appId: command.appId,
      ownerUserId: command.ownerUserId,
      storageKey,
      mimeType: command.mimeType,
      sizeBytes: command.sizeBytes,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    });

    return {
      uploadUrl: `https://storage.local/upload/${encodeURIComponent(storageKey)}`,
      storageKey,
      expireAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async confirmUpload(command: {
    appId: string;
    ownerUserId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<FileConfirmResult> {
    const fileRecord = await this.database.findFileByOwnerAndStorageKey(
      command.appId,
      command.ownerUserId,
      command.storageKey,
    );

    if (!fileRecord) {
      forbidden("FILE_ACCESS_DENIED", "File confirmation is not allowed for this owner.");
    }

    const confirmed = await this.database.confirmFile(fileRecord.id, command.mimeType, command.sizeBytes);
    if (!confirmed) {
      forbidden("FILE_ACCESS_DENIED", "File confirmation is not allowed for this owner.");
    }

    return {
      storageKey: confirmed.storageKey,
      downloadUrl: await this.getDownloadUrl(command.appId, command.ownerUserId, command.storageKey),
    };
  }

  async getDownloadUrl(appId: string, userId: string, storageKey: string): Promise<string> {
    const fileRecord = await this.database.findFileByAppAndStorageKey(appId, storageKey);

    if (!fileRecord || fileRecord.ownerUserId !== userId || fileRecord.status !== "CONFIRMED") {
      forbidden("FILE_ACCESS_DENIED", "File download is not allowed for this user.");
    }

    return `https://storage.local/download/${encodeURIComponent(storageKey)}?token=${randomId(
      "dl",
    )}`;
  }
}
