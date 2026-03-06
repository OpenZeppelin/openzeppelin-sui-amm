import { Suspense } from "react"
import AmmConfigCard from "./components/AmmConfigCard"
import TraderAccountCard from "./components/TraderAccountCard"
import NetworkSupportChecker from "./components/NetworkSupportChecker"

export default function Home() {
  return (
    <Suspense fallback={<></>}>
      <>
        <NetworkSupportChecker />
        <div className="flex w-full flex-grow flex-col items-center justify-center rounded-md p-3">
          <div className="flex w-full flex-col items-center gap-6">
            <AmmConfigCard />
            <TraderAccountCard />
          </div>
        </div>
      </>
    </Suspense>
  )
}
