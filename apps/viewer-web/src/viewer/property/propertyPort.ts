import type { ProductKey } from '@bim4d/contracts';

/**
 * 속성 하나. 값은 화면에 그대로 쓸 문자열이고, 원본 Type은 따로 보존한다.
 *
 * 값 Type은 파일마다 다르다 (기준서 10.2, 10.3절). 여기서 숫자나 날짜로 해석하지 않는다.
 * 해석이 필요한 기능이 생기면 그때 Type을 보고 그 기능 안에서 처리한다.
 */
export interface PropertyEntry {
  readonly name: string;
  readonly value: string;
  /** `IfcLabel`, `IfcLengthMeasure` 같은 원본 Type. 없을 수 있다. */
  readonly type: string | null;
}

/**
 * PropertySet 또는 QuantitySet 하나.
 *
 * 표준 Pset(`Pset_`)인지 사용자 정의인지로 거르지 않는다. 원본에 있는 것은 전량 보존한다
 * (AGENTS.md 2.4절). Exporter마다 이름이 다르므로 특정 이름을 전제하지 않는다.
 */
export interface PropertySetEntry {
  readonly name: string;
  readonly properties: readonly PropertyEntry[];
}

export interface ProductProperties {
  readonly product: ProductKey;
  /** IFC Entity 이름. 예: `IFCWALL`. */
  readonly category: string | null;
  readonly name: string | null;
  /** Entity 고정 Attribute (기준서 7절). */
  readonly attributes: readonly PropertyEntry[];
  /** 원본 PropertySet과 QuantitySet 전량. */
  readonly sets: readonly PropertySetEntry[];
}

/**
 * 부재 하나의 속성을 읽는 Query Port.
 *
 * 조회는 Event가 아니라 Port 직접 호출이다 (마스터 계획 5.3절).
 */
export interface PropertyPort {
  /** 적재되지 않은 모델이거나 파일에 없는 GlobalId면 null. */
  read(product: ProductKey): Promise<ProductProperties | null>;
}
