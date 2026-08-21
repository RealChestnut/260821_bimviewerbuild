import type { AppComponent, AppContext, ProductKey, Unsubscribe } from '@bim4d/contracts';

import '../viewer/selection/selectionEvents.js';
import type {
  ProductProperties,
  PropertyEntry,
  PropertyPort,
} from '../viewer/property/propertyPort.js';

export interface PropertyPanelOptions {
  /** 속성을 그릴 요소의 CSS selector. */
  readonly selector: string;
  /** 속성 조회 Port. 조회는 Event가 아니라 Port 직접 호출이다 (마스터 계획 5.3절). */
  readonly port: PropertyPort;
}

const IDLE_TEXT = '선택 없음';
const ATTRIBUTE_SECTION = '기본 Attribute';
const NO_SET_TEXT = '속성 Set 없음';

/**
 * 고른 부재의 속성을 보여 주는 화면 조각.
 *
 * 원본 PropertySet과 QuantitySet은 이름이나 접두어로 거르지 않고 전량 보여 준다
 * (AGENTS.md 2.4절). 표준 Pset이 없는 파일도 정상이므로 없다고 오류로 다루지 않는다.
 * 여러 개를 고른 경우에는 속성을 그리지 않는다. 무엇의 속성인지 알 수 없기 때문이다.
 */
export const createPropertyPanel = (options: PropertyPanelOptions): AppComponent => {
  const { port } = options;

  let context: AppContext | null = null;
  let container: HTMLElement | null = null;
  let subscription: Unsubscribe | null = null;
  /** 마지막으로 요청한 조회. 늦게 도착한 이전 결과를 버리는 데 쓴다. */
  let pending = 0;

  const requireContext = (): AppContext => {
    if (context === null) throw new Error('initialize를 먼저 호출해야 한다.');
    return context;
  };

  const writeText = (text: string): void => {
    if (container === null) return;

    const paragraph = document.createElement('p');
    paragraph.className = 'property-empty';
    paragraph.dataset['testid'] = 'property-empty';
    paragraph.textContent = text;
    container.replaceChildren(paragraph);
  };

  const renderSection = (name: string, entries: readonly PropertyEntry[]): HTMLElement => {
    const section = document.createElement('section');
    section.className = 'property-set';
    section.dataset['testid'] = 'property-set';
    section.dataset['setName'] = name;

    const heading = document.createElement('h3');
    heading.textContent = name;
    section.append(heading);

    const table = document.createElement('table');
    const body = document.createElement('tbody');
    for (const entry of entries) {
      const row = document.createElement('tr');
      row.dataset['testid'] = 'property-row';

      const key = document.createElement('th');
      key.scope = 'row';
      key.textContent = entry.name;

      const value = document.createElement('td');
      value.textContent = entry.value;
      // 원본 Type은 값 옆에 두지 않는다. 필요할 때만 보이도록 title로 남긴다.
      if (entry.type !== null) value.title = entry.type;

      row.append(key, value);
      body.append(row);
    }
    table.append(body);
    section.append(table);
    return section;
  };

  const render = (properties: ProductProperties): void => {
    if (container === null) return;

    const fragment = document.createDocumentFragment();

    const title = document.createElement('h2');
    title.dataset['testid'] = 'property-title';
    title.textContent = properties.name ?? properties.category ?? '(이름 없음)';
    fragment.append(title);

    const category = document.createElement('p');
    category.className = 'property-category';
    category.dataset['testid'] = 'property-category';
    category.textContent = properties.category ?? '';
    fragment.append(category);

    if (properties.attributes.length > 0) {
      fragment.append(renderSection(ATTRIBUTE_SECTION, properties.attributes));
    }
    for (const set of properties.sets) {
      fragment.append(renderSection(set.name, set.properties));
    }
    if (properties.sets.length === 0) {
      // 표준 Pset이 없는 파일도 정상이다 (AGENTS.md 2.4절). 없다는 사실만 알린다.
      const note = document.createElement('p');
      note.className = 'property-empty';
      note.dataset['testid'] = 'property-no-set';
      note.textContent = NO_SET_TEXT;
      fragment.append(note);
    }

    container.replaceChildren(fragment);
  };

  const show = async (selected: readonly ProductKey[]): Promise<void> => {
    const app = requireContext();
    const token = ++pending;

    if (selected.length === 0) {
      writeText(IDLE_TEXT);
      return;
    }
    if (selected.length > 1) {
      writeText(`${String(selected.length)}개 선택`);
      return;
    }

    const [product] = selected;
    if (product === undefined) return;

    const properties = await port.read(product);
    // 읽는 사이에 선택이 또 바뀌었다면 늦게 온 결과를 버린다.
    if (token !== pending) return;

    if (properties === null) {
      app.logger.warn('속성을 읽지 못했다.', { ...product });
      writeText(IDLE_TEXT);
      return;
    }
    render(properties);
  };

  return {
    id: 'shell.property-panel',

    initialize: (appContext: AppContext) => {
      const found = document.querySelector<HTMLElement>(options.selector);
      if (found === null) {
        return Promise.reject(new Error(`요소를 찾지 못했다: ${options.selector}`));
      }
      context = appContext;
      container = found;
      writeText(IDLE_TEXT);
      return Promise.resolve();
    },

    start: () => {
      const app = requireContext();
      subscription ??= app.events.subscribe('selection/changed', ({ payload }) => {
        void show(payload.selected);
      });
      return Promise.resolve();
    },

    stop: () => {
      subscription?.();
      subscription = null;
      return Promise.resolve();
    },

    dispose: () => {
      subscription?.();
      subscription = null;
      pending += 1;

      container?.replaceChildren();
      container = null;
      context = null;
      return Promise.resolve();
    },
  };
};
