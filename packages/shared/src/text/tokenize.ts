/** Divide em sentenças por pontuação final ou quebra de linha. Abreviações ("Dr.") podem gerar cortes extras. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

export function tokenize(sentence: string): string[] {
  return sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}
