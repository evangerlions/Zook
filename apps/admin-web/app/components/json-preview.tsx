import { JsonCode } from "./json-code";

export function JsonPreview({ value }: { value: unknown }) {
  const rendered = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";

  return (
    <pre className="json-preview">
      <JsonCode value={rendered} />
    </pre>
  );
}
