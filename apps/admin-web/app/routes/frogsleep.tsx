import "../styles/frogsleep.css";
import { Alert, Button, Card, Col, Descriptions, Input, Modal, Row, Skeleton, Statistic, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useAdminSession } from "../lib/admin-session";
import { frogSleepAdminApi, type FrogSleepOperations } from "../lib/frogsleep-admin-api";
import { formatApiError } from "../lib/format";
import { FrogSleepRecords } from "../components/frogsleep/frogsleep-records";
import { capabilityLabels, resourceLabels } from "../components/frogsleep/frogsleep-labels";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";

export default function FrogSleepRoute() {
  const { selectedAppId, completeWorkspaceTransition } = useAdminSession();
  const [document, setDocument] = useState<FrogSleepOperations | null>(null), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  const [job, setJob] = useState<{ id: string; generation: number } | null>(null), [reason, setReason] = useState(""), [verify, setVerify] = useState(false);
  const [result, setResult] = useState("");
  const scope = useRef({ app: selectedAppId, generation: 0, active: true });
  if (scope.current.app !== selectedAppId) scope.current = { app: selectedAppId, generation: scope.current.generation + 1, active: true };
  useEffect(() => { scope.current.active = true; return () => { scope.current.active = false; }; }, []);
  useEffect(() => {
    let current = true;
    setDocument(null); setError(""); setJob(null); setVerify(false); setReason("");
    if (selectedAppId !== "frogsleep") { setResult(""); completeWorkspaceTransition(); return; }
    setLoading(true);
    frogSleepAdminApi.operations().then(value => { if (current) setDocument(value); })
      .catch(err => { if (current) setError(formatApiError(err)); })
      .finally(() => { if (current) { setLoading(false); completeWorkspaceTransition(); } });
    return () => { current = false; };
  }, [selectedAppId, refresh]);
  if (selectedAppId !== "frogsleep") return <section className="empty-state">请先切换到 FrogSleep 项目空间。</section>;
  return <section className="stack frogsleep-operations">
    <header className="page-header"><div><h1>Sleep 运营</h1><p>账号、邀请、方向授权、会话与通知投递状态。</p></div><Button loading={loading} onClick={() => setRefresh(v => v + 1)}>刷新概览</Button></header>
    <Alert type="info" showIcon title="投递状态说明" description="provider_accepted 表示服务商已接受，delivered 仅依据服务商回执确认。结果未知的任务禁止重投；没有可用设备时用户仍可查看 App 内通知。" />
    {error ? <Alert type="error" showIcon title="概览加载失败" description={error} action={<Button onClick={() => setRefresh(v => v + 1)}>重试加载</Button>} /> : null}
    {loading ? <Card><Skeleton active /></Card> : document ? <>
      <Row gutter={[16,16]}>{Object.entries(document.metrics).map(([key,value]) => <Col xs={24} sm={12} lg={6} key={key}><Card><Statistic title={resourceLabels[key as keyof typeof resourceLabels] ?? key} value={value} /></Card></Col>)}</Row>
      <Card title="当前服务能力"><Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={Object.entries(document.capabilities).map(([key,value]) => ({ key, label: capabilityLabels[key] ?? key, children: <Tag color={value ? "green" : "default"}>{value ? "启用" : "关闭"}</Tag> }))} /></Card>
    </> : null}
    {result ? <Alert type="success" showIcon title={result} /> : null}
    <FrogSleepRecords key={selectedAppId} revision={refresh} onRetry={id => { setJob({ id, generation: scope.current.generation }); setReason(""); }} />
    <Modal open={Boolean(job) && !verify} title="重试失败通知" okText="验证并重试" cancelText="取消" onCancel={() => setJob(null)}
      okButtonProps={{ disabled: !reason.trim() }} onOk={() => setVerify(true)}>
      <p>将沿用原任务与剩余尝试次数。投递时会再次检查静默、关系和方向授权。</p>
      <Input.TextArea aria-label="通知重试原因" value={reason} maxLength={500} placeholder="填写处理原因" onChange={e => setReason(e.target.value)} />
    </Modal>
    <SensitiveOperationModal open={verify} operation="frogsleep.notifications.retry" title="验证通知重试权限" description="重试已知失败的原任务。"
      onClose={() => { setVerify(false); setJob(null); }} onAuthorized={async () => {
        const generation = scope.current.generation;
        if (!job || !scope.current.active || scope.current.app !== "frogsleep" || job.generation !== generation) return;
        const response = await frogSleepAdminApi.retry(job.id, reason);
        if (!scope.current.active || scope.current.app !== "frogsleep" || scope.current.generation !== generation) return;
        if (!response.queued) throw new Error("队列暂不可用，任务已保留为失败状态。");
        setResult("原通知任务已进入队列，将重新检查接收权限。"); setRefresh(v => v + 1);
      }} />
  </section>;
}
