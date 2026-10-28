import { Alert, Button, Card, Col, Descriptions, Empty, Row, Space, Statistic, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError } from "../lib/format";
import type { BodyLogRetentionMetrics } from "../lib/types";

const rate = (value: number | null) => value === null ? "未成熟 / 无样本" : `${(value * 100).toFixed(1)}%`;
const sourceNames: Record<string,string> = {invitation:"邀请",sevenDayPlan:"七日计划",buddy:"搭子",group:"小组",campaign:"活动"};
const states: Record<string,string> = {active:"生效中",queued:"排队生效",expired:"已到期",issued:"已发放"};

export default function BodyLogRetentionRoute() {
  const { selectedAppId, completeWorkspaceTransition } = useAdminSession();
  const [document,setDocument] = useState<BodyLogRetentionMetrics | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [refresh,setRefresh] = useState(0);
  useEffect(()=>{
    let active=true;
    setDocument(null);setError(null);
    if(selectedAppId!=="bodylog") {setLoading(false);completeWorkspaceTransition();return;}
    setLoading(true);
    adminApi.getBodyLogRetentionMetrics().then(value=>{if(active)setDocument(value);})
      .catch(value=>{if(active)setError(formatApiError(value));})
      .finally(()=>{if(active){setLoading(false);completeWorkspaceTransition();}});
    return ()=>{active=false;};
  },[selectedAppId,refresh]);
  if(selectedAppId!=="bodylog") return <section className="empty-state">请先切换到 BodyLog 项目空间。</section>;
  const rows=document?.experiments.flatMap(experiment=>experiment.variants.map(variant=>({...variant,experimentId:experiment.experimentId}))) ?? [];
  const plan=document?.experiment.design;
  return <section className="stack">
    <header className="page-header"><div><h1>留存与邀请</h1><p>分别核对授权行为与权威业务账本；数据不足时不作效果结论。</p></div>
      <Button loading={loading} onClick={()=>setRefresh(value=>value+1)}>刷新数据</Button></header>
    {error && <Alert type="error" showIcon message="加载失败" description={error} action={<Button onClick={()=>setRefresh(value=>value+1)}>重试</Button>} />}
    {!document ? <Card loading={loading}>{!loading && !error && <Empty description="暂无报告" />}</Card> : <>
      <Alert type="info" showIcon message="口径与隐私" description="事件漏斗只覆盖自愿授权用户，缺失事件不等于转化失败；资格和发奖取服务端账本。以下均为累计聚合，不返回用户、健康明细或邀请令牌。" />
      <Row gutter={[16,16]}>{[
        ["已归因",document.invitationBusiness.attributed],["已达资格（含已奖励）",document.invitationBusiness.qualified],
        ["已奖励受邀人",document.invitationBusiness.rewardedInvitees],["已奖励邀请人",document.invitationBusiness.rewardedInviters],
      ].map(([title,value])=><Col xs={12} lg={6} key={String(title)}><Card><Statistic title={title} value={Number(value)} /></Card></Col>)}</Row>
      <Card title="邀请观察漏斗 · 授权用户去重">
        <Table pagination={false} rowKey="event" dataSource={Object.entries(document.invitationFunnelUniqueUsers).map(([event,count])=>({event,count}))}
          columns={[{title:"观察事件",dataIndex:"event",render:(value:string)=>({invitation_created:"创建邀请",invitation_opened:"打开邀请",invitation_attributed:"确认归因"})[value] ?? value},{title:"累计用户数",dataIndex:"count"}]} />
      </Card>
      <Card title="已发奖励账本">
        <Table pagination={false} rowKey={row=>`${row.source}:${row.type}:${row.state}`} dataSource={document.rewards} locale={{emptyText:"尚无已发放奖励"}}
          columns={[{title:"来源",dataIndex:"source",render:(value:string)=>sourceNames[value] ?? value},{title:"类型",dataIndex:"type",render:(value:string)=>value==="premium"?"Premium权益":"徽章"},
            {title:"状态",dataIndex:"state",render:(value:string)=><Tag>{states[value] ?? value}</Tag>},{title:"笔数",dataIndex:"count"}]} />
      </Card>
      <Card title="完成计划后的行为留存 · UTC">
        <Alert type="warning" showIcon message="D1/D7只统计目标日已结束的样本；null不是0%。相同账号在其他实验中的行为不计入本实验。" />
        <Table pagination={false} scroll={{x:800}} rowKey={row=>`${row.experimentId}:${row.variant}`} dataSource={rows} locale={{emptyText:"暂无成熟实验数据，不能宣称留存提升"}}
          columns={[{title:"实验",dataIndex:"experimentId"},{title:"组别",dataIndex:"variant",render:(value:string)=>value==="control"?"对照组":"实验组"},{title:"实际暴露",dataIndex:"exposed"},
            {title:"D1",render:(_,row)=><Space direction="vertical"><span>{rate(row.d1.rate)}</span><small>{row.d1.retained} / {row.d1.eligible} 成熟样本</small></Space>},
            {title:"D7",render:(_,row)=><Space direction="vertical"><span>{rate(row.d7.rate)}</span><small>{row.d7.retained} / {row.d7.eligible} 成熟样本</small></Space>}]} />
      </Card>
      <Card title={<Space>实验准备<Tag color={document.experiment.enabled?"green":"default"}>{document.experiment.enabled?"已启用":"未启用"}</Tag></Space>}>
        <p>此页面只核验配置，不开启实验或代替发布签字。</p>
        {document.experiment.errors.length>0 && <Alert type="warning" showIcon message="配置尚未满足启用条件" description={<ul>{document.experiment.errors.map(value=><li key={value}>{value}</li>)}</ul>} />}
        {plan && <Descriptions column={{xs:1,md:2}} items={[
          {key:"id",label:"实验 / 负责人",children:`${document.experiment.id} / ${plan.owner}`},
          {key:"allocation",label:"实验组占比",children:`${document.experiment.treatmentPercent}%`},
          {key:"metric",label:"主指标",children:"完成计划后D7本地目标行为留存"},
          {key:"sample",label:"每组成熟目标 / 规划下限",children:`${plan.targetMaturePerVariant} / ${document.experiment.requiredPerVariant}`},
          {key:"inputs",label:"基线 / 最小差异",children:`${rate(plan.baselineRate)} / ${(plan.minimumDetectableEffect*100).toFixed(1)}个百分点`},
          {key:"window",label:"入组 / 随访 / 迟到窗口",children:`${plan.minimumEnrollmentDays} / ${plan.followupDays} / ${plan.lateArrivalDays}天`},
          {key:"guards",label:"预设护栏",children:`账号失败率≤${rate(plan.guardrails.maxAuthFailureRate)}，重复动作0，本地操作P95≤${plan.guardrails.maxLocalActionP95Millis}ms`},
          {key:"stop",label:"停止规则",children:"固定窗口和样本，不按中途显著性提前结束"},
        ]} />}
        <p>规划下限为独立比例的正态近似（双侧α=0.05，功效80%），需实际基线、授权率和流失率复核；不是显著性或效果保证。</p>
      </Card>
      <p>生成时间：{new Date(document.generatedAt).toLocaleString()} · 队列/回执不代表APNs已经展示。</p>
    </>}
  </section>;
}
