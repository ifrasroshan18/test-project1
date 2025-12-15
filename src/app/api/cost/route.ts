import { getServerSession } from "next-auth"
import { authOptions } from "@/auth"
import { CostManagementClient } from "@azure/arm-costmanagement"
import { TokenCredential, AccessToken } from "@azure/core-auth"

class UserTokenCredential implements TokenCredential {
  constructor(private token: string) {}

  async getToken(scopes: string | string[], options?: any): Promise<AccessToken | null> {
    return { token: this.token, expiresOnTimestamp: Date.now() + 3600000 }
  }
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !session.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get("scope")
  if (!scope) {
    return Response.json({ error: "Scope is required" }, { status: 400 })
  }

  try {
    const client = new CostManagementClient(new UserTokenCredential(session.accessToken as string))
    const queryResult = await client.query.usage(scope, {
      type: "ActualCost",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "Daily",
        aggregation: {
          totalCost: {
            name: "Cost",
            function: "Sum"
          }
        },
        grouping: [
          {
            type: "Dimension",
            name: "ServiceName"
          }
        ]
      }
    })
    return Response.json(queryResult)
  } catch (error) {
    console.error("Error fetching cost data:", error)
    return Response.json({ error: "Failed to fetch cost data" }, { status: 500 })
  }
}