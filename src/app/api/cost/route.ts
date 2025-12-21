export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const scope = searchParams.get("scope")
  if (!scope) {
    return Response.json({ error: "Scope is required" }, { status: 400 })
  }

  // Authentication has been removed. Fetching from Azure is disabled until auth is reintroduced.
  return Response.json({ error: "Azure fetch disabled: authentication removed" }, { status: 501 })
}