import ActiveOrdersCard from "../../components/ActiveOrdersCard"
import BalancesCard from "../../components/BalancesCard"
import EventFeedCard from "../../components/EventFeedCard"
import NetworkSupportChecker from "../../components/NetworkSupportChecker"
import PriceChartCard from "../../components/PriceChartCard"
import TraderAccountCard from "../../components/TraderAccountCard"

export default function DashboardPage() {
  return (
    <>
      <NetworkSupportChecker />
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-200/70">
          Live mid price, active orders, balances, and on-chain events for your
          market maker executor.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr] lg:items-stretch">
        <PriceChartCard />
        <BalancesCard />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr] lg:items-stretch">
        <div className="flex min-w-0 flex-col gap-6">
          <ActiveOrdersCard />
          <TraderAccountCard />
        </div>
        <div className="min-w-0 lg:relative lg:min-h-0">
          <div className="lg:absolute lg:inset-0">
            <EventFeedCard />
          </div>
        </div>
      </div>
    </>
  )
}
