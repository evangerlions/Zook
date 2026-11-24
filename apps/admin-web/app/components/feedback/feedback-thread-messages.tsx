import { Alert, Button, Empty, Image, Skeleton, Spin } from "antd";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { adminFeedbackApi } from "../../lib/admin-feedback-api";
import { feedbackAttachmentDataUrl, feedbackAttachmentMeta } from "../../lib/feedback";
import { formatApiError, formatTimestamp } from "../../lib/format";
import type { AdminFeedbackAttachmentContentDocument, AdminFeedbackImage, AdminFeedbackMessage, AdminFeedbackThread } from "../../lib/types";

function FeedbackImage({ feedbackId, image }: { feedbackId: string; image: AdminFeedbackImage }) {
  const card = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState<AdminFeedbackAttachmentContentDocument>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const node = card.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setOpened(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController();
    void adminFeedbackApi.getAiNovelFeedbackAttachment(feedbackId, image.id, controller.signal)
      .then(setContent)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt, feedbackId, image.id, opened]);

  function openImage() {
    setOpened(true);
    setFailed(false);
    setAttempt((value) => value + 1);
  }

  return (
    <div className="feedback-attachment-card" ref={card}>
      {content ? <Image alt={image.fileName} src={feedbackAttachmentDataUrl(content)} /> : (
        <div className="feedback-attachment-loading">
          {opened && !failed ? <Spin size="small" aria-label="图片加载中" /> : (
            <Button size="small" onClick={openImage}>{failed ? "重试" : "查看图片"}</Button>
          )}
        </div>
      )}
      <strong title={image.fileName}>{image.fileName}</strong>
      <small>{feedbackAttachmentMeta(image)}</small>
    </div>
  );
}

function MessageBubble({ feedbackId, message }: { feedbackId: string; message: AdminFeedbackMessage }) {
  const sender = message.sender === "support" ? "客服" : "用户";
  return (
    <article className={`feedback-message feedback-message--${message.sender}`}>
      <div className="feedback-message-meta">
        <strong>{sender}</strong>
        <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
      </div>
      {message.message ? <p>{message.message}</p> : null}
      {message.attachments.length > 0 ? (
        <div className="feedback-attachment-grid">
          {message.attachments.map((image) => <FeedbackImage key={image.id} feedbackId={feedbackId} image={image} />)}
        </div>
      ) : null}
    </article>
  );
}

export function FeedbackThreadMessages({ feedbackId, revision }: { feedbackId: string; revision: number }) {
  const [thread, setThread] = useState<AdminFeedbackThread>();
  const [error, setError] = useState<{ message: string; source: "latest" | "older" }>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [paging, setPaging] = useState(false);
  const pageRequest = useRef<AbortController | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const scrollHeight = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setLoading(true);
    setPaging(false);
    void adminFeedbackApi.getAiNovelFeedbackThread(feedbackId, undefined, controller.signal)
      .then((latest) => {
        if (controller.signal.aborted) return;
        scrollHeight.current = undefined;
        setThread(latest);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError({ message: formatApiError(error), source: "latest" });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      controller.abort();
      pageRequest.current?.abort();
      pageRequest.current = null;
    };
  }, [feedbackId, retry, revision]);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node || !thread) return;
    node.scrollTop = scrollHeight.current === undefined
      ? node.scrollHeight
      : node.scrollTop + (node.scrollHeight - scrollHeight.current);
    scrollHeight.current = undefined;
  }, [thread]);

  async function loadOlder() {
    if (!thread?.nextCursor || pageRequest.current) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setError(undefined);
    setPaging(true);
    try {
      const older = await adminFeedbackApi.getAiNovelFeedbackThread(feedbackId, thread.nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      scrollHeight.current = viewport.current?.scrollHeight;
      setThread({ ...older, messages: [...older.messages, ...thread.messages] });
    } catch (error) {
      if (!controller.signal.aborted) setError({ message: formatApiError(error), source: "older" });
    } finally {
      if (pageRequest.current === controller) pageRequest.current = null;
      if (!controller.signal.aborted) setPaging(false);
    }
  }

  return (
    <div className="feedback-thread-messages" ref={viewport} aria-label="反馈对话" aria-busy={loading}>
      {error ? <Alert showIcon type="error" title={error.message} action={
        <Button size="small" onClick={() => { if (error.source === "older") void loadOlder(); else setRetry((n) => n + 1); }}>重试</Button>
      } /> : null}
      {loading && !thread ? <Skeleton active /> : null}
      {thread?.nextCursor ? (
        <Button size="small" disabled={loading} loading={paging} onClick={() => void loadOlder()}>
          加载更早的消息
        </Button>
      ) : null}
      {thread?.messages.length === 0 ? <Empty description="暂无消息" /> : null}
      {thread?.messages.map((message) => <MessageBubble key={message.id} feedbackId={feedbackId} message={message} />)}
    </div>
  );
}
