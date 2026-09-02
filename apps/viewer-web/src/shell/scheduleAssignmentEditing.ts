import type {
  GlobalId,
  ModelRefBindingPort,
  ProductKey,
  TaskId,
  TaskOperation,
} from '@bim4d/contracts';

import '../scheduler/schedulerEvents.js';
import type { ScheduleAssignmentRow } from '../scheduler/schedulerEvents.js';
import type { SelectedProduct } from '../viewer/selection/selectionEvents.js';

import type { EditSubmit } from './scheduleRowEditing.js';

/**
 * 부재를 Task에 걸고 끊는 화면 조각.
 *
 * 파일에 적는 값은 `modelRef`이고 뷰어가 주는 값은 `modelId`다. 그 사이를 옮기는 일은
 * `ModelRefBindingPort` 한 곳만 지난다. 바인딩 규칙이 파일명 대조에서 fingerprint로
 * 바뀌어도 이 화면은 고치지 않는다 (ADR-0005의 잠정 항목).
 */

/** ADR-0002가 확정한 네 값. 화면에는 짧은 우리말로 적는다. */
const OPERATIONS: readonly TaskOperation[] = ['CONSTRUCT', 'DEMOLISH', 'TEMPORARY', 'MODIFY'];

const OPERATION_LABELS: Readonly<Record<TaskOperation, string>> = {
  CONSTRUCT: '시공',
  DEMOLISH: '철거',
  TEMPORARY: '임시',
  MODIFY: '수정',
};

/** GlobalId는 22자다. 칩에는 앞부분만 적고 전체는 title로 남긴다. */
const shortId = (globalId: GlobalId): string => `${globalId.slice(0, 8)}…`;

const button = (testId: string, label: string, title: string): HTMLButtonElement => {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset['testid'] = testId;
  node.textContent = label;
  node.title = title;
  return node;
};

export interface AssignmentEditorOptions {
  readonly taskId: TaskId;
  /** 일정 전체의 연결. 이 Task 것만 걸러 그린다. */
  readonly assignments: readonly ScheduleAssignmentRow[];
  /** 지금 뷰어에서 고른 부재. */
  readonly selection: readonly SelectedProduct[];
  readonly binding: ModelRefBindingPort;
  readonly submit: EditSubmit;
  readonly write: (message: string) => void;
  /** 부재를 3D에서 고르게 한다. */
  readonly showInViewer: (products: readonly ProductKey[]) => void;
}

/**
 * 고른 Task 아래에 펼치는 부재 연결 줄.
 *
 * 열려 있지 않은 모델의 부재도 그린다. 무엇에 걸려 있는지는 모델과 무관하게 일정의 사실이고,
 * 잘못 걸린 것을 지울 수도 있어야 한다. 다만 3D에서 고르는 일은 열린 모델에만 된다.
 */
export const createAssignmentEditor = (options: AssignmentEditorOptions): HTMLLIElement => {
  const { taskId, binding, submit } = options;

  const item = document.createElement('li');
  item.dataset['testid'] = 'assignment-editor';
  item.dataset['taskId'] = taskId;

  const mine = options.assignments.filter((assignment) => assignment.taskId === taskId);

  const chips = document.createElement('span');
  chips.dataset['testid'] = 'assignment-chips';

  for (const assignment of mine) {
    const chip = document.createElement('span');
    chip.dataset['testid'] = 'assignment-chip';
    chip.dataset['globalId'] = assignment.productGlobalId;
    chip.dataset['bound'] = String(binding.idOf(assignment.modelRef) !== null);

    const label = document.createElement('span');
    label.dataset['testid'] = 'assignment-label';
    label.textContent = `${OPERATION_LABELS[assignment.operation]} ${assignment.modelRef} · ${shortId(assignment.productGlobalId)}`;
    label.title = `${assignment.modelRef} / ${assignment.productGlobalId}`;

    const remove = button('assignment-remove', '×', '연결 끊기');
    remove.addEventListener('click', () => {
      submit([
        {
          kind: 'unassign-products',
          taskId,
          modelRef: assignment.modelRef,
          productGlobalIds: [assignment.productGlobalId],
        },
      ]);
    });

    chip.append(label, remove);
    chips.append(chip);
  }

  if (mine.length === 0) {
    const empty = document.createElement('span');
    empty.dataset['testid'] = 'assignment-empty';
    empty.textContent = '걸린 부재 없음';
    chips.append(empty);
  }

  const shown: ProductKey[] = [];
  for (const assignment of mine) {
    const modelId = binding.idOf(assignment.modelRef);
    if (modelId === null) continue;
    shown.push({ modelId, globalId: assignment.productGlobalId });
  }

  const show = button('assignment-show', '3D에서 보기', '걸린 부재를 3D에서 고른다');
  show.disabled = shown.length === 0;
  show.addEventListener('click', () => {
    options.showInViewer(shown);
  });

  const operation = document.createElement('select');
  operation.dataset['testid'] = 'assignment-operation';
  operation.setAttribute('aria-label', '연결 종류');
  operation.append(
    ...OPERATIONS.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = OPERATION_LABELS[value];
      return option;
    }),
  );

  const add = button(
    'assignment-add',
    `고른 부재 걸기 (${String(options.selection.length)})`,
    '뷰어에서 고른 부재를 이 Task에 건다',
  );
  add.disabled = options.selection.length === 0;
  add.addEventListener('click', () => {
    const chosen = OPERATIONS.find((candidate) => candidate === operation.value);
    if (chosen === undefined) {
      options.write('편집 실패: 연결 종류를 골라야 한다.');
      return;
    }

    /*
     * 모델별로 묶어 보낸다. 편집 하나가 한 모델을 다루고, 여러 모델을 골랐어도 한 명령으로
     * 나가므로 하나라도 실패하면 전부 반영되지 않는다.
     */
    const byRef = new Map<string, GlobalId[]>();
    for (const product of options.selection) {
      const modelRef = binding.refOf(product.modelId);
      if (modelRef === null) {
        // 일정에 적을 이름이 없는 모델이다. 무엇을 적을지 화면이 지어내지 않는다.
        options.write('편집 실패: 일정에 묶이지 않은 모델의 부재다.');
        return;
      }
      const bucket = byRef.get(modelRef);
      if (bucket === undefined) byRef.set(modelRef, [product.globalId]);
      else bucket.push(product.globalId);
    }

    submit(
      [...byRef].map(([modelRef, productGlobalIds]) => ({
        kind: 'assign-products',
        taskId,
        modelRef,
        operation: chosen,
        productGlobalIds,
      })),
    );
  });

  item.append(chips, show, operation, add);
  return item;
};
