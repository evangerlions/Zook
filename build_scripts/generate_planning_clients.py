"""Generate additive session models from the canonical session schema."""
from pathlib import Path
import re
import yaml
root=Path(__file__).resolve().parents[1]
schema=yaml.safe_load((root/'api-contracts/openapi/lighttick/api.yaml').read_text())['components']['schemas']['LightTickPlanningSession']
swift=['// BEGIN GENERATED PLANNING SESSION',"""
public enum PlanningScalar: Codable, Equatable, Sendable {
    case text(String), minutes(Int)
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) { self = .minutes(n) } else { self = .text(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .text(let s): try c.encode(s); case .minutes(let n): try c.encode(n) }
    }
    public var display: String { switch self { case .text(let s): s; case .minutes(let n): String(n) } }
}
public struct PlanningValue: Codable, Equatable, Sendable {
    public let value: PlanningScalar
    public let source: String
    public let source_message_id: String?
}
public struct PlanningSession: Codable, Equatable, Sendable {
"""]
kt=['// BEGIN GENERATED PLANNING SESSION',"""
sealed interface PlanningScalar {
    data class Text(val value: String): PlanningScalar
    data class Minutes(val value: Int): PlanningScalar
}
data class PlanningValue(val value: PlanningScalar, val source: String, val source_message_id: String? = null)
data class PlanningSession(
"""]
for name,p in schema['properties'].items():
    t=p.get('type');nullable=p.get('nullable',False) or (isinstance(t,list) and 'null' in t)
    if isinstance(t,list): t=next(x for x in t if x!='null')
    if name=='context': st,ktype='[String: PlanningValue]','Map<String, PlanningValue>'
    elif t=='array': st,ktype='[String]','List<String>'
    else: st,ktype={'string':('String','String'),'integer':('Int','Int'),'boolean':('Bool','Boolean')}[t]
    swift.append(f'    public let {name}: {st}'+('?' if nullable else ''))
    kt.append(f'    val {name}: {ktype}'+('?' if nullable else '')+',')
swift+=['}','// END GENERATED PLANNING SESSION']
kt+=[')','// END GENERATED PLANNING SESSION']
for path,lines in [('api-contracts/clients/lighttick/swift/Sources/LightTickContracts/LightTickContracts.swift',swift),('api-contracts/clients/lighttick/kotlin/src/main/kotlin/lighttick/contracts/LightTickContracts.kt',kt)]:
    p=root/path;s=p.read_text();s=re.sub(r'\n// BEGIN GENERATED PLANNING SESSION.*// END GENERATED PLANNING SESSION\n?', '',s,flags=re.S)
    p.write_text(s.rstrip()+'\n\n'+'\n'.join(lines)+'\n')
