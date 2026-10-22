export function readFileGoal(
  filePath: string,
  expectedSha256: string,
): {
  filePath: string;
  expectedSha256: string;
  actualSha256: string;
  passed: boolean;
};
