import { providerTone } from "./provider-presentation";

export function ProviderBadge({ provider }: { provider: string }) {
  const tone = providerTone(provider);
  return (
    <span aria-label={`Provider ${provider}`} className={`llm-provider-badge llm-provider-badge--${tone}`} title={provider}>
      <span aria-hidden="true" className="llm-provider-badge__dot" />
      <span className="llm-provider-badge__label">{provider}</span>
    </span>
  );
}
