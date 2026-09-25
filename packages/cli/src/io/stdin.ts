/** The whole of stdin as UTF-8 text: the input of `warrant guard` (REQ-ENF-004). */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}
