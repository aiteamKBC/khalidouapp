export type IdleRequestAvailability = {
  availableSeconds: number;
};

export function requestableIdleMinutes(
  option: IdleRequestAvailability,
): number {
  return Math.max(0, Math.floor(option.availableSeconds / 60));
}

export function totalRequestableIdleMinutes(
  options: readonly IdleRequestAvailability[],
): number {
  return options.reduce(
    (total, option) => total + requestableIdleMinutes(option),
    0,
  );
}
