const runLive = process.env.POWERTRANZ_LIVE === "1" ? describe : describe.skip;

runLive("PowerTranz staging smoke", () => {
  it("responds to GET /api/alive", async () => {
    const baseUrl = process.env.POWERTRANZ_BASE_URL;
    if (!baseUrl) {
      throw new Error("POWERTRANZ_BASE_URL is not configured");
    }

    const url = `${baseUrl.replace(/\/$/, "")}/api/alive`;
    const res = await fetch(url, { method: "GET" });

    expect(res.ok).toBe(true);
    expect(res.status).toBeLessThan(500);
  });
});
