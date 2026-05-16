import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";

export function JsonEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const extensions = useMemo(
    () => [
      json(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "14px",
        },
        ".cm-editor": {
          backgroundColor: "transparent",
        },
        ".cm-scroller": {
          fontFamily: "\"IBM Plex Mono\", \"SFMono-Regular\", monospace",
        },
        ".cm-gutters": {
          backgroundColor: "rgba(9, 14, 29, 0.72)",
          borderRight: "1px solid rgba(148, 163, 184, 0.12)",
          color: "#7c8ba1",
        },
      }),
    ],
    [],
  );

  return (
    <div className={`json-editor${readOnly ? " is-readonly" : ""}`}>
      <CodeMirror
        basicSetup={{
          foldGutter: true,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        editable={!readOnly}
        extensions={extensions}
        height="520px"
        onChange={onChange}
        readOnly={readOnly}
        theme={oneDark}
        value={value}
      />
    </div>
  );
}
