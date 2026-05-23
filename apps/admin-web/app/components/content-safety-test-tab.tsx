import { Alert, Button, Input } from "antd";
import { useState } from "react";

import { Field } from "./field";
import { JsonPreview } from "./json-preview";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type { AdminContentSafetyTestDocument } from "../lib/types";

export function ContentSafetyTestTab() {
  const { clearNotice, setNotice } = useAdminSession();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdminContentSafetyTestDocument | null>(null);

  async function handleTest() {
    const normalized = text.trim();
    if (!normalized) {
      setNotice(makeNotice("error", "请输入要测试的文本。"));
      return;
    }
    setLoading(true);
    setResult(null);
    clearNotice();
    try {
      setResult(await adminApi.testContentSafety(normalized));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="content-safety-section">
      <div className="section-heading">
        <div>
          <h3>审核测试</h3>
          <p>仅管理员可调用。使用当前已保存配置真实执行审核链路，命中拦截的文本会进入拦截记录。</p>
        </div>
        <Button disabled={!text.trim()} loading={loading} onClick={() => void handleTest()} type="primary">
          测试审核
        </Button>
      </div>
      <div className="content-safety-test-grid">
        <Field label="测试文本" hint="通过或 fail-open 的文本只记录哈希与长度；命中拦截时会保留明文用于排查。">
          <Input.TextArea
            autoSize={{ minRows: 7, maxRows: 12 }}
            onChange={(event) => setText(event.target.value)}
            placeholder="输入一段文本，查看关键词 / LLM / 阿里云审核结果"
            value={text}
          />
        </Field>
        <div className="content-safety-test-result">
          {result ? (
            <Alert
              message={result.allowed ? "允许发送" : "命中拦截"}
              description={
                <div className="stack">
                  <div>结果：{result.message}</div>
                  <div>层级：{result.layer}</div>
                  <div>错误码：{result.code}</div>
                  <div>文本长度：{result.textLength}</div>
                  <div>耗时：{result.elapsedMs} ms</div>
                  {result.category ? <div>分类：{result.category}</div> : null}
                  {result.keywordId ? <div>关键词规则 ID：{result.keywordId}</div> : null}
                  {result.failureReason ? <div>失败原因：{result.failureReason}</div> : null}
                  {result.failureDetail ? <div>失败详情：{result.failureDetail}</div> : null}
                  {result.llmDebug ? (
                    <div className="content-safety-test-debug">
                      <div>LLM 输入 / 输出：</div>
                      <JsonPreview value={result.llmDebug} />
                    </div>
                  ) : null}
                </div>
              }
              showIcon
              type={result.allowed ? "success" : "error"}
            />
          ) : (
            <div className="empty-inline">输入文本后点击测试审核，结果会显示在这里。</div>
          )}
        </div>
      </div>
    </section>
  );
}
