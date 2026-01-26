import { Suspense } from "react"
import AmmConfigCard from "./components/AmmConfigCard"
import NetworkSupportChecker from "./components/NetworkSupportChecker"

export default function Home() {
  return (
    <Suspense fallback={<></>}>
      <>
        <NetworkSupportChecker />
        <div className="flex w-full flex-grow flex-col items-center justify-center rounded-md p-3">
          <AmmConfigCard />
        </div>
      </>
    </Suspense>
  )
}
