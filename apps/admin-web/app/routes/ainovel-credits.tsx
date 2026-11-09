import { Alert } from "antd";
import { useEffect, useState } from "react";
import { useAdminSession } from "../lib/admin-session";
import { CreditGrantForm } from "../components/ai-novel-credits/credit-grant-form";
import { CreditGrantRecords } from "../components/ai-novel-credits/credit-grant-records";

export default function AiNovelCreditsRoute() {
  const { adminUser, selectedAppId, completeWorkspaceTransition } = useAdminSession();
  const [revision, setRevision] = useState(0);
  useEffect(() => { completeWorkspaceTransition(); }, [completeWorkspaceTransition]);
  if (selectedAppId !== "ai_novel") return <Alert type="info" message="请选择橘子写作项目空间。" />;
  return <section className="stack"><header className="page-header"><h1>创作点发放</h1></header>
    <CreditGrantForm key={adminUser} adminUser={adminUser} onGranted={() => setRevision(value => value + 1)} />
    <CreditGrantRecords key={revision} revision={revision} />
  </section>;
}
