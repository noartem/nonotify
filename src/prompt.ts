import { cancel, confirm, isCancel, select, text } from "@clack/prompts";

export async function askRequired(question: string): Promise<string> {
  return askRequiredWithInitial(question);
}

export async function askRequiredWithInitial(
  question: string,
  initialValue?: string,
): Promise<string> {
  const message = normalizeQuestion(question);

  const value = await text({
    message,
    initialValue,
    validate(input) {
      if (!input || input.trim() === "") {
        return "Value cannot be empty";
      }

      return undefined;
    },
  });

  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return value.trim();
}

export async function askConfirm(
  question: string,
  initialValue = false,
): Promise<boolean> {
  const value = await confirm({
    message: normalizeQuestion(question),
    initialValue,
  });

  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return value;
}

type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export async function askSelect(
  question: string,
  options: SelectOption[],
): Promise<string> {
  const value = await select<string>({
    message: normalizeQuestion(question),
    options,
  });

  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return value;
}

function normalizeQuestion(question: string): string {
  return question.trim().replace(/:\s*$/, "");
}
