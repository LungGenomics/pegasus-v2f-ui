// Add Data wizard orchestrator. Holds the WizardState, swaps between
// step components, and provides Cancel / step navigation.

import { useState } from "react";
import { StepSource } from "./step-source";
import { StepInterpret } from "./step-interpret";
import { StepMapping } from "./step-mapping";
import { StepBuild } from "./step-build";
import { INITIAL_STATE, type WizardState } from "./types";

interface Props {
  onCancel: () => void;
  onDone: (sourceName: string) => void;
}

const STEPS = [
  { idx: 1, label: "Source" },
  { idx: 2, label: "Interpret" },
  { idx: 3, label: "Mapping" },
  { idx: 4, label: "Build" },
] as const;

export function AddDataWizard({ onCancel, onDone }: Props) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  const patch = (p: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...p }));
  const setStep = (step: WizardState["step"]) => patch({ step });

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => {
          const active = state.step === s.idx;
          const done = state.step > s.idx;
          return (
            <li key={s.idx} className="flex items-center gap-2">
              <span
                className={`flex items-center justify-center size-5 rounded-full text-[10px] font-medium ${
                  done
                    ? "bg-success text-success-content"
                    : active
                      ? "bg-primary text-primary-content"
                      : "bg-base-300 text-base-content/40"
                }`}
              >
                {done ? "✓" : s.idx}
              </span>
              <span
                className={
                  active
                    ? "text-base-content"
                    : done
                      ? "text-base-content/60"
                      : "text-base-content/30"
                }
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <span className="text-base-content/20">·</span>
              )}
            </li>
          );
        })}
      </ol>

      {state.step === 1 && (
        <StepSource
          state={state}
          onPatch={patch}
          onNext={() => setStep(2)}
          onCancel={onCancel}
        />
      )}
      {state.step === 2 && (
        <StepInterpret
          state={state}
          onPatch={patch}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}
      {state.step === 3 && (
        <StepMapping
          state={state}
          onPatch={patch}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}
      {state.step === 4 && (
        <StepBuild
          state={state}
          onBack={() => setStep(3)}
          onDone={onDone}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}
