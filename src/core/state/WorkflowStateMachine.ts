import { WorkflowState } from "../../shared/types";

/**
 * Error thrown when an invalid workflow state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
  /**
   * Constructs an InvalidStateTransitionError.
   * @param from Originating WorkflowState.
   * @param to Target WorkflowState.
   */
  constructor(
    public readonly from: WorkflowState,
    public readonly to: WorkflowState,
  ) {
    super(`Invalid workflow state transition from "${from}" to "${to}".`);
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Validates and enforces state transition lifecycles across workflow states.
 *
 * @example
 * ```typescript
 * WorkflowStateMachine.validateTransition(WorkflowState.CREATED, WorkflowState.QUEUED); // OK
 * WorkflowStateMachine.validateTransition(WorkflowState.COMPLETED, WorkflowState.RUNNING); // Throws Error
 * ```
 */
export class WorkflowStateMachine {
  private static readonly allowedTransitions: Record<
    WorkflowState,
    Set<WorkflowState>
  > = {
    [WorkflowState.CREATED]: new Set([
      WorkflowState.QUEUED,
      WorkflowState.CLAIMED,
      WorkflowState.RUNNING,
      WorkflowState.CANCELLED,
    ]),
    [WorkflowState.QUEUED]: new Set([
      WorkflowState.CLAIMED,
      WorkflowState.RUNNING,
      WorkflowState.CANCELLED,
      WorkflowState.EXPIRED,
    ]),
    [WorkflowState.CLAIMED]: new Set([
      WorkflowState.RUNNING,
      WorkflowState.COMPLETED,
      WorkflowState.FAILED,
      WorkflowState.CANCELLED,
      WorkflowState.EXPIRED,
    ]),
    [WorkflowState.RUNNING]: new Set([
      WorkflowState.WAITING,
      WorkflowState.COMPLETED,
      WorkflowState.FAILED,
      WorkflowState.CANCELLED,
      WorkflowState.EXPIRED,
    ]),
    [WorkflowState.WAITING]: new Set([
      WorkflowState.RUNNING,
      WorkflowState.FAILED,
      WorkflowState.CANCELLED,
      WorkflowState.EXPIRED,
    ]),
    [WorkflowState.COMPLETED]: new Set([]),
    [WorkflowState.FAILED]: new Set([
      WorkflowState.QUEUED,
      WorkflowState.CLAIMED,
    ]),
    [WorkflowState.CANCELLED]: new Set([]),
    [WorkflowState.EXPIRED]: new Set([
      WorkflowState.QUEUED,
      WorkflowState.CLAIMED,
    ]),
  };

  /**
   * Checks whether a state transition from `from` to `to` is valid.
   */
  public static canTransition(
    from: WorkflowState,
    to: WorkflowState,
  ): boolean {
    if (from === to) return true;
    const allowed = this.allowedTransitions[from];
    return allowed ? allowed.has(to) : false;
  }

  /**
   * Validates a state transition, throwing InvalidStateTransitionError if invalid.
   */
  public static validateTransition(
    from: WorkflowState,
    to: WorkflowState,
  ): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }
  }

  /**
   * Checks if a WorkflowState is a terminal state.
   */
  public static isTerminal(state: WorkflowState): boolean {
    return (
      state === WorkflowState.COMPLETED ||
      state === WorkflowState.CANCELLED ||
      state === WorkflowState.FAILED ||
      state === WorkflowState.EXPIRED
    );
  }
}
