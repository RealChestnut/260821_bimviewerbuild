/**
 * IFC Property 값을 화면에 쓸 문자열로 만든다.
 *
 * IFC 값 Type은 파일마다 다르고 종류가 많다 (기준서 10.2, 10.3절). 여기서 숫자나 날짜로
 * 해석하지 않는다. 보이는 그대로 옮기고, 원본 Type은 값과 따로 보존한다.
 */

/** `IfcLogical`은 참·거짓 외에 UNKNOWN을 갖는다. 값이 비어 있으면 그 뜻이다 (기준서 10.2절). */
const LOGICAL_TYPE = 'IFCLOGICAL';

const hasValueKey = (value: object): value is { readonly value: unknown } => 'value' in value;

/**
 * 값 하나를 문자열로 만든다.
 *
 * 목록형 Property(`IfcPropertyListValue`, `IfcPropertyEnumeratedValue`)는 쉼표로 잇는다.
 * 값이 없으면 빈 문자열이다. 값 없음은 오류가 아니라 흔한 정상이다 (기준서 7절).
 */
export const formatIfcValue = (value: unknown, type?: string | null): string => {
  if (value === null || value === undefined) {
    return (type ?? '').toUpperCase() === LOGICAL_TYPE ? 'UNKNOWN' : '';
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    return value
      .map((member: unknown) => formatIfcValue(member, type))
      .filter((member) => member.length > 0)
      .join(', ');
  }
  if (typeof value === 'object' && hasValueKey(value)) {
    // 중첩된 값 표현. `{ value: ... }` 한 겹을 벗겨 같은 규칙으로 처리한다.
    return formatIfcValue(value.value, type);
  }
  return '';
};
