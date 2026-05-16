export async function writeClipboard(value: string) {
  if (!navigator?.clipboard?.writeText) {
    throw new Error("当前浏览器不支持剪贴板写入。");
  }

  await navigator.clipboard.writeText(value);
}
