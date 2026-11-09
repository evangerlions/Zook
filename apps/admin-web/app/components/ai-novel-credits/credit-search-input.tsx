import { AutoComplete, Input } from "antd";
import { useState } from "react";
import "./credit-search-input.css";

interface Props {
  value: string;
  history: string[];
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
}

export function CreditSearchInput({ value, history, disabled, loading, onChange, onSearch }: Props) {
  const [open, setOpen] = useState(false);
  function search(value: string) { setOpen(false); onSearch(value); }
  return <AutoComplete
    value={value}
    disabled={disabled}
    open={open && history.length > 0 && !disabled}
    options={history.map(query => ({ value: query }))}
    onChange={onChange}
    onSelect={search}
    onFocus={() => setOpen(true)}
    onBlur={() => setOpen(false)}
    onOpenChange={setOpen}
    filterOption={false}
    virtual={false}
    listHeight={160}
    style={{ width: "100%" }}
    classNames={{ popup: { root: "credit-search-history-popup" } }}
  >
    <Input.Search aria-label="搜索用户" disabled={disabled} loading={loading} onSearch={search} enterButton="搜索" />
  </AutoComplete>;
}
