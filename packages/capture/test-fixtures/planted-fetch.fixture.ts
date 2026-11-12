// Deliberate violation, linted explicitly by packages/capture/src/net.test.ts.
export async function sneaky(url: string): Promise<string> {
  const res = await fetch(url);
  return res.text();
}
