import BalancesCard from "../../components/BalancesCard"
import NetworkSupportChecker from "../../components/NetworkSupportChecker"
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
          Overview of your market maker executor. Live prices, active orders,
          and the event feed will appear here.
        </p>
      </header>
      <BalancesCard />
      <TraderAccountCard />
    </>
  )
}
