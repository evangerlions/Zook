import { Alert, Button, Form, Modal } from "antd";
import { useEffect, useState } from "react";

import { RemoteLogPullMainCard } from "../components/remote-log-pull-main-card";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { JsonPreview } from "../components/json-preview";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { writeClipboard } from "../lib/clipboard";
import { formatApiError, makeNotice } from "../lib/format";
import type {
  AdminRemoteLogPullSettingsDocument,
  AdminRemoteLogPullTaskListDocument,
  RemoteLogPullSettings,
} from "../lib/types";

export default function RemoteLogPullRoute() {
  const {
    apps,
    selectedAppId,
    reloadBootstrap,
    setNotice,
    clearNotice,
    completeWorkspaceTransition,
  } = useAdminSession();
  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  const [document, setDocument] = useState<AdminRemoteLogPullSettingsDocument | null>(null);
  const [tasks, setTasks] = useState<AdminRemoteLogPullTaskListDocument | null>(null);
  const [config, setConfig] = useState<RemoteLogPullSettings | null>(null);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [failureTask, setFailureTask] = useState<NonNullable<typeof tasks>["items"][number] | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const [tab, setTab] = useState<"settings" | "tasks">("settings");
  const [taskForm] = Form.useForm<{ userId: string; did: string }>();
  const settingsTabActive = tab === "settings";

  async function loadLatest() {
    if (!selectedAppId) {
      setDocument(null);
      setTasks(null);
      setConfig(null);
      setDesc("");
      completeWorkspaceTransition();
      return;
    }

    setLoading(true);
    try {
      const [settingsPayload, tasksPayload] = await Promise.all([
        adminApi.getRemoteLogPull(selectedAppId),
        adminApi.listRemoteLogPullTasks(selectedAppId),
      ]);
      setDocument(settingsPayload);
      setConfig(settingsPayload.config);
      setTasks(tasksPayload);
      setDesc("");
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    void loadLatest();
  }, [selectedAppId]);

  async function handleSave() {
    if (!selectedAppId || !config) {
      return;
    }

    setSaving(true);
    clearNotice();
    try {
      const payload = await adminApi.updateRemoteLogPull(selectedAppId, config, desc.trim() || undefined);
      setDocument(payload);
      setConfig(payload.config);
      setDesc("");
      await reloadBootstrap();
      setNotice(makeNotice("success", "Remote Log Pull 设置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setLoading(true);
    try {
      const payload = await adminApi.getRemoteLogPullRevision(selectedAppId, revision);
      setDocument(payload);
      setConfig(payload.config);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRestoreRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setRestoringRevision(revision);
    clearNotice();
    try {
      const [latestPayload, revisionPayload] = await Promise.all([
        adminApi.getRemoteLogPull(selectedAppId),
        adminApi.getRemoteLogPullRevision(selectedAppId, revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(JSON.stringify(latestPayload.config, null, 2));
      setRestoreNewValue(JSON.stringify(revisionPayload.config, null, 2));
      setRestoreDesc(`回滚到版本 R${revision}`);
      setRestoreModalOpen(true);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleConfirmRestoreRevision() {
    if (!selectedAppId || !restoreRevision) {
      return;
    }

    setRestoringRevision(restoreRevision);
    clearNotice();
    try {
      const payload = await adminApi.restoreRemoteLogPull(selectedAppId, restoreRevision, restoreDesc.trim() || undefined);
      setDocument(payload);
      setConfig(payload.config);
      setDesc("");
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      setNotice(makeNotice("success", `已恢复到版本 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleCreateTask() {
    if (!selectedAppId) {
      return;
    }

    const values = await taskForm.validateFields();
    setCreatingTask(true);
    clearNotice();
    try {
      const payload = await adminApi.createRemoteLogPullTask(selectedAppId, values.userId, values.did);
      setTasks(payload);
      taskForm.resetFields();
      setNotice(makeNotice("success", "日志回捞任务已创建。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleCancelTask(taskId: string) {
    if (!selectedAppId) {
      return;
    }

    setCancellingTaskId(taskId);
    clearNotice();
    try {
      const payload = await adminApi.cancelRemoteLogPullTask(selectedAppId, taskId);
      setTasks(payload);
      setNotice(makeNotice("success", `任务 ${taskId} 已取消。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setCancellingTaskId(null);
    }
  }

  async function copyTaskValue(kind: "Task ID" | "UID" | "DID", value: string) {
    try {
      await writeClipboard(value);
      setNotice(makeNotice("success", `已复制 ${kind}：${value}`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    }
  }

  if (!selectedApp) {
    return (
      <section className="empty-state">
        请先在“应用管理”中创建或选择一个 App，再进入 `Remote Log Pull`。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>Remote Log Pull</h1>
          <p>当前项目空间为 {selectedApp.appName}。这里单独管理当前 App 的日志回捞设置和任务。</p>
        </div>
      </header>

      <div className={`page-grid page-grid--config${!settingsTabActive || !historyExpanded ? " is-history-collapsed" : ""}`}>
        <div className={`stack remote-log-pull-main-stack${settingsTabActive ? "" : " is-tasks-tab"}`}>
          <RemoteLogPullMainCard
            cancellingTaskId={cancellingTaskId}
            config={config}
            creatingTask={creatingTask}
            desc={desc}
            document={document}
            onCancelTask={(taskId) => void handleCancelTask(taskId)}
            onConfigChange={setConfig}
            onCopyTaskValue={(kind, value) => void copyTaskValue(kind, value)}
            onCreateTask={() => void handleCreateTask()}
            onDescChange={setDesc}
            onFailureTaskOpen={setFailureTask}
            onRefresh={() => void loadLatest()}
            onSave={() => void handleSave()}
            onTabChange={setTab}
            saving={saving}
            tab={tab}
            taskForm={taskForm}
            tasks={tasks}
          />
        </div>

        {settingsTabActive ? (
          <RevisionHistoryDock expanded={historyExpanded} onToggle={() => setHistoryExpanded((current) => !current)}>
            <RevisionList
              activeRevision={document?.revision}
              compact
              latestRevision={document?.revisions?.[0]?.revision}
              loadingRevision={restoringRevision}
              onRestore={(revision) => void handleRequestRestoreRevision(revision)}
              onSelect={(revision) => void handleViewRevision(revision)}
              revisions={document?.revisions ?? []}
            />
          </RevisionHistoryDock>
        ) : (
          <aside aria-hidden="true" className="side-card side-card--history history-dock-placeholder" />
        )}
      </div>
      <SaveConfirmModal
        desc={restoreDesc}
        descPlaceholder="例如：误修改后回滚到稳定版本"
        loading={Boolean(restoreRevision) && restoringRevision === restoreRevision}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        onCancel={() => {
          setRestoreModalOpen(false);
          setRestoreRevision(null);
          setRestoreDesc("");
        }}
        onConfirm={() => void handleConfirmRestoreRevision()}
        onDescChange={setRestoreDesc}
        okText="确认回滚"
        open={restoreModalOpen}
        title={restoreRevision ? `确认回滚到版本 R${restoreRevision}` : "确认回滚"}
        autoGenerateDesc={false}
      />
      <Modal
        footer={(
          <Button onClick={() => setFailureTask(null)} type="primary">
            关闭
          </Button>
        )}
        onCancel={() => setFailureTask(null)}
        open={Boolean(failureTask)}
        title={failureTask ? `失败详情 · ${failureTask.taskId}` : "失败详情"}
        width={760}
      >
        {failureTask ? (
          <div className="stack">
            <Alert
              message="这里展示客户端最终上报给后端的失败信息。"
              showIcon
              type="warning"
            />
            <JsonPreview value={{
              taskId: failureTask.taskId,
              uid: failureTask.userId,
              did: failureTask.did,
              status: failureTask.status,
              failedAt: failureTask.failedAt ?? null,
              failureReason: failureTask.failureReason ?? null,
            }} />
          </div>
        ) : null}
      </Modal>

    </section>
  );
}
