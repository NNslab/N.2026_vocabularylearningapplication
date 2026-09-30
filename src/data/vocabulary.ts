import { vocabPart1 } from "./vocab_part1";
import { vocabPart2 } from "./vocab_part2";
import { vocabPart3 } from "./vocab_part3";

export interface Word {
  word: string;
  pos: string;
  chinese: string;
  example: string;
  exampleChinese: string;
}

export const VOCABULARY_DAYS: { [key: number]: Word[] } = {
  ...vocabPart1,
  ...vocabPart2,
  ...vocabPart3
};
