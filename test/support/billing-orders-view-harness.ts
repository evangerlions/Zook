import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

interface ViewNode { type: string; props: Record<string, any> }
type Node = ViewNode | string | number | null | undefined;

/** Executes the real TSX handlers with minimal deterministic hooks, not a browser renderer. */
export async function billingOrdersViewHarness(api: Record<string, unknown>) {
  const requireAdmin = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
  const ts = requireAdmin("typescript");
  const source = await readFile(new URL("../../apps/admin-web/app/components/billing-orders-section.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const cells: unknown[] = [];
  let index = 0;
  const useState = (initial?: unknown) => {
    const position = index++;
    if (!(position in cells)) cells[position] = initial;
    return [cells[position], (value: unknown) => { cells[position] = typeof value === "function" ? value(cells[position]) : value; }];
  };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const antd = Object.fromEntries(["Alert", "Button", "Drawer", "Empty", "Input", "Select", "Space", "Table", "Tag", "Timeline"].map((type) => [type, type]));
  const modules: Record<string, unknown> = {
    "react": { useState, useRef: (value: unknown) => useState({ current: value })[0], useEffect: () => undefined },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "antd": { ...antd, DatePicker: { RangePicker: "RangePicker" }, Descriptions: { Item: "DescriptionItem" }, Typography: { Text: "Text" } },
    "@ant-design/icons": { ReloadOutlined: "ReloadIcon" },
    "../lib/admin-api": { adminApi: api },
    "../lib/admin-session": { useAdminSession: () => ({ setNotice: () => undefined }) },
    "../lib/billing-format": { BILLING_STATUS_OPTIONS: [], billingProductLabel: () => "", billingStatusColor: () => "", billingStatusLabel: () => "", formatBillingMoney: () => "" },
    "../lib/format": { formatApiError: String, formatTimestamp: String, makeNotice: () => ({}) },
  };
  const exports: { BillingOrdersSection?: (props: { appId: string }) => ViewNode } = {};
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected view dependency ${name}`);
    return modules[name];
  } });
  function render() { index = 0; return exports.BillingOrdersSection!({ appId: "ai_novel" }); }
  function nodes(tree: Node | Node[]): ViewNode[] {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...nodes(tree.props.children as Node | Node[])];
  }
  const find = (tree: ViewNode, type: string, predicate: (props: Record<string, any>) => boolean = () => true) => nodes(tree).find((node) => node.type === type && predicate(node.props));
  return { render, find, flush: () => new Promise<void>((resolve) => setImmediate(resolve)) };
}
