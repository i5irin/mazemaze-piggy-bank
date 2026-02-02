export type IntegerInputErrorOptions = {
  required?: boolean;
};

export const formatCurrency = (value: number | null): string => {
  if (value === null) {
    return "—";
  }
  return `¥${value.toLocaleString("en-US")}`;
};

export const formatIntegerInput = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const normalized = raw.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) {
    return raw;
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    return raw;
  }
  return parsed.toLocaleString("en-US");
};

export const parseIntegerInput = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = raw.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return parsed;
};

export const getIntegerInputError = (
  raw: string,
  options: IntegerInputErrorOptions = {},
): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return options.required ? "Enter a value." : null;
  }
  const normalized = raw.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) {
    if (normalized.includes(".")) {
      return "Decimals are not allowed.";
    }
    return "Enter a non-negative integer.";
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    return "Enter a valid number.";
  }
  return null;
};
