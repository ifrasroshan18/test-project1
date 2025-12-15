"use client"

import { useSession, signIn, signOut } from "next-auth/react"
import CostAnalyticsApp from "@/components/CostAnalyticsApp"

export default function Home() {
  const { data: session } = useSession()

  if (session) {
    return (
      <div className="min-h-screen p-8">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold">Azure M365 Cost Analytics</h1>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Sign Out
          </button>
        </header>
        <main>
          {/* App components will go here */}
          <p>Welcome, {session.user?.name}!</p>
          <CostAnalyticsApp />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Azure M365 Cost Analytics</h1>
        <p className="mb-8">Login with your Entra ID to access cost reports.</p>
        <button
          onClick={() => signIn("azure-ad")}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Sign In with Entra ID
        </button>
      </div>
    </div>
  )
}
