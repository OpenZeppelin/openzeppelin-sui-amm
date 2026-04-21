"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Mock Data aligned with actual codebase ─────────────────────────────────

const MOCK_WALLET = "0x1a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef1234567890";
const MOCK_AMM_CONFIG_ID = "0xcafe1234abcd5678ef901234567890abcdef1234567890abcdef1234567890ab";
const MOCK_ADMIN_CAP_ID = "0xad01cafe89ab01234567890abcdef1234567890abcdef1234567890abcdef12";
const MOCK_TRADER_ACCOUNT_ID = "0xdeadbeef01234567890abcdef01234567890abcdef01234567890abcdef012345";
const MOCK_BALANCE_MANAGER_ID = "0xba1a0ce001234567890abcdef01234567890abcdef01234567890abcdef01234";
const MOCK_PACKAGE_ID = "0x09af1234567890abcdef01234567890abcdef01234567890abcdef012345c4d2";
const MOCK_DEEPBOOK_REGISTRY_ID = "0xdb0012345678abcdef1234567890abcdef1234567890abcdef1234567890abcd";
const MOCK_PYTH_FEED_ID = "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";

const truncAddr = (a, n = 6) => a ? `${a.slice(0, n + 2)}...${a.slice(-n)}` : "";

const generateMockOrders = () => [
  { id: "0xa1b2c3", clientOrderId: 1, side: "BID", price: 3.4125, size: 580, status: "OPEN", ts: Date.now() - 12000 },
  { id: "0xd4e5f6", clientOrderId: 2, side: "BID", price: 3.3980, size: 580, status: "OPEN", ts: Date.now() - 12000 },
  { id: "0x789abc", clientOrderId: 3, side: "ASK", price: 3.4410, size: 420, status: "OPEN", ts: Date.now() - 12000 },
  { id: "0xdef012", clientOrderId: 4, side: "ASK", price: 3.4575, size: 420, status: "OPEN", ts: Date.now() - 12000 },
];

const generateTradeHistory = () => [
  { digest: "8Jk2mN...xQ4p", side: "BUY", price: 3.4050, qty: 120, pnl: 2.14, ts: Date.now() - 300000 },
  { digest: "3Rw7yB...hT9s", side: "SELL", price: 3.4380, qty: 85, pnl: 1.87, ts: Date.now() - 600000 },
  { digest: "5Lm0pK...uF2a", side: "BUY", price: 3.3920, qty: 200, pnl: -0.56, ts: Date.now() - 900000 },
  { digest: "9Qx4cD...jW6n", side: "SELL", price: 3.4510, qty: 150, pnl: 3.22, ts: Date.now() - 1200000 },
  { digest: "1Hn8vE...rG3b", side: "BUY", price: 3.4100, qty: 90, pnl: 0.73, ts: Date.now() - 1800000 },
  { digest: "7Yt5wA...kL1c", side: "SELL", price: 3.4200, qty: 300, pnl: 4.11, ts: Date.now() - 2400000 },
  { digest: "2Fp6xZ...mN8d", side: "BUY", price: 3.3850, qty: 175, pnl: -1.02, ts: Date.now() - 3600000 },
  { digest: "6Us3bH...oP5e", side: "SELL", price: 3.4450, qty: 110, pnl: 1.45, ts: Date.now() - 5400000 },
];

const generatePriceHistory = () => {
  const pts = [];
  let p = 3.38;
  for (let i = 60; i >= 0; i--) {
    p += (Math.random() - 0.495) * 0.008;
    pts.push({ t: Date.now() - i * 60000, price: parseFloat(p.toFixed(4)) });
  }
  return pts;
};

// Events matching actual events.move: QuoteUpdated, AMMConfigCreated, AMMConfigUpdated, TraderAccountCreated
const generateEvents = () => [
  { type: "QuoteUpdated", data: { price: "3426700000", base_spread_bps: "25", volatility_spread_bps: "200" }, ts: Date.now() - 5000 },
  { type: "QuoteUpdated", data: { price: "3418000000", base_spread_bps: "25", volatility_spread_bps: "200" }, ts: Date.now() - 65000 },
  { type: "QuoteUpdated", data: { price: "3431000000", base_spread_bps: "25", volatility_spread_bps: "200" }, ts: Date.now() - 125000 },
  { type: "AMMConfigUpdated", data: { config_id: MOCK_AMM_CONFIG_ID }, ts: Date.now() - 400000 },
  { type: "TraderAccountCreated", data: { trader_account_id: MOCK_TRADER_ACCOUNT_ID }, ts: Date.now() - 900000 },
  { type: "AMMConfigCreated", data: { config_id: MOCK_AMM_CONFIG_ID }, ts: Date.now() - 1200000 },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600&display=swap');
:root{--sui-blue:#4DA2FF;--sui-blue-dim:rgba(77,162,255,0.12);--sui-blue-glow:rgba(77,162,255,0.25);--sui-pink:#FE8BC2;--sui-pink-dim:rgba(254,139,194,0.10);--sui-dark:#030F1C;--sui-dark-card:#0A1929;--sui-dark-border:#1A2A3D;--sui-text:#E1E8EF;--sui-text-muted:#6B7C8D;--sui-success:#2DD4A0;--sui-success-dim:rgba(45,212,160,0.10);--sui-error:#FF6B6B;--sui-error-dim:rgba(255,107,107,0.10);--sui-warning:#FFB547;--sui-warning-dim:rgba(255,181,71,0.10);--radius:10px;--radius-sm:6px}
*{margin:0;padding:0;box-sizing:border-box}
body,#root{font-family:'DM Sans',sans-serif;background:var(--sui-dark);color:var(--sui-text);min-height:100vh}
.mono{font-family:'JetBrains Mono',monospace}
.app-shell{display:flex;min-height:100vh}
.sidebar{width:220px;min-height:100vh;background:var(--sui-dark-card);border-right:1px solid var(--sui-dark-border);display:flex;flex-direction:column;position:fixed;top:0;left:0;z-index:10}
.sidebar-logo{padding:20px 18px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--sui-dark-border)}
.sidebar-logo span{font-weight:700;font-size:15px;letter-spacing:-0.3px}
.sidebar-logo .accent{color:var(--sui-blue)}
.sidebar-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-sm);font-size:13.5px;font-weight:500;cursor:pointer;transition:all .15s;color:var(--sui-text-muted);border:1px solid transparent;user-select:none}
.nav-item:hover{color:var(--sui-text);background:rgba(77,162,255,0.04)}
.nav-item.active{color:var(--sui-blue);background:var(--sui-blue-dim);border-color:rgba(77,162,255,0.15)}
.nav-section{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--sui-text-muted);padding:16px 12px 6px;font-weight:600}
.sidebar-footer{padding:14px 18px;border-top:1px solid var(--sui-dark-border);font-size:11px;color:var(--sui-text-muted)}
.sidebar-footer a{color:var(--sui-blue);text-decoration:none}
.main{margin-left:220px;flex:1;display:flex;flex-direction:column;min-height:100vh}
.topbar{height:56px;border-bottom:1px solid var(--sui-dark-border);display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(10,25,41,0.85);backdrop-filter:blur(12px);position:sticky;top:0;z-index:5}
.topbar-title{font-size:15px;font-weight:600}
.topbar-right{display:flex;align-items:center;gap:12px}
.content{padding:24px;flex:1}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--radius-sm);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:all .15s;user-select:none}
.btn-primary{background:var(--sui-blue);color:#fff}.btn-primary:hover{background:#3b8fe8;box-shadow:0 0 20px var(--sui-blue-glow)}
.btn-outline{background:transparent;color:var(--sui-blue);border-color:rgba(77,162,255,0.3)}.btn-outline:hover{background:var(--sui-blue-dim)}
.btn-ghost{background:transparent;color:var(--sui-text-muted)}.btn-ghost:hover{color:var(--sui-text);background:rgba(255,255,255,0.04)}
.btn-success{background:var(--sui-success);color:#030F1C}.btn-danger{background:var(--sui-error);color:#fff}
.btn-sm{padding:5px 10px;font-size:12px}
.wallet-btn{display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:var(--radius);border:1px solid var(--sui-dark-border);background:var(--sui-dark-card);cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;color:var(--sui-text);transition:all .15s}
.wallet-btn:hover{border-color:var(--sui-blue)}.wallet-btn.connected{border-color:var(--sui-success)}
.wallet-dot{width:8px;height:8px;border-radius:50%}.wallet-dot.on{background:var(--sui-success);box-shadow:0 0 8px rgba(45,212,160,0.5)}.wallet-dot.off{background:var(--sui-text-muted)}
.card{background:var(--sui-dark-card);border:1px solid var(--sui-dark-border);border-radius:var(--radius);overflow:hidden}
.card-header{padding:14px 18px;border-bottom:1px solid var(--sui-dark-border);display:flex;align-items:center;justify-content:space-between}
.card-header h3{font-size:13px;font-weight:600}.card-body{padding:18px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px}
.stat-card{background:var(--sui-dark-card);border:1px solid var(--sui-dark-border);border-radius:var(--radius);padding:16px 18px;transition:all .15s}
.stat-card:hover{border-color:rgba(77,162,255,0.2)}
.stat-label{font-size:11px;color:var(--sui-text-muted);text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:8px}
.stat-value{font-size:22px;font-weight:700;letter-spacing:-0.5px}
.stat-sub{font-size:11px;color:var(--sui-text-muted);margin-top:4px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid-2-1{display:grid;grid-template-columns:2fr 1fr;gap:16px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;padding:10px 14px;color:var(--sui-text-muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;border-bottom:1px solid var(--sui-dark-border)}
td{padding:10px 14px;border-bottom:1px solid rgba(26,42,61,0.5)}
tr:hover td{background:rgba(77,162,255,0.02)}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.tag-bid{background:var(--sui-success-dim);color:var(--sui-success)}.tag-ask{background:var(--sui-error-dim);color:var(--sui-error)}
.tag-buy{background:var(--sui-success-dim);color:var(--sui-success)}.tag-sell{background:var(--sui-error-dim);color:var(--sui-error)}
.tag-open{background:var(--sui-blue-dim);color:var(--sui-blue)}.tag-event{background:var(--sui-warning-dim);color:var(--sui-warning)}
.tag-config{background:rgba(77,162,255,0.1);color:var(--sui-blue)}.tag-account{background:var(--sui-pink-dim);color:var(--sui-pink)}
.form-group{margin-bottom:16px}.form-label{display:block;font-size:12px;font-weight:600;color:var(--sui-text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px}
.form-input{width:100%;padding:9px 12px;border-radius:var(--radius-sm);border:1px solid var(--sui-dark-border);background:var(--sui-dark);color:var(--sui-text);font-family:'JetBrains Mono',monospace;font-size:13px;transition:border-color .15s;outline:none}
.form-input:focus{border-color:var(--sui-blue);box-shadow:0 0 0 2px var(--sui-blue-dim)}
.form-hint{font-size:11px;color:var(--sui-text-muted);margin-top:4px}
.slider-wrap{display:flex;align-items:center;gap:12px}.slider-wrap input[type=range]{flex:1;accent-color:var(--sui-blue)}
.slider-val{font-family:'JetBrains Mono',monospace;font-size:13px;min-width:60px;text-align:right}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0}
.toggle{width:40px;height:22px;border-radius:11px;background:var(--sui-dark-border);cursor:pointer;position:relative;transition:background .2s}
.toggle.on{background:var(--sui-blue)}.toggle::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}.toggle.on::after{transform:translateX(18px)}
.modal-overlay{position:fixed;inset:0;background:rgba(3,15,28,0.8);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:100;animation:fadeIn .15s ease}
.modal{background:var(--sui-dark-card);border:1px solid var(--sui-dark-border);border-radius:14px;width:420px;max-width:95vw;animation:slideUp .2s ease}
.modal-header{padding:18px 22px;border-bottom:1px solid var(--sui-dark-border);display:flex;align-items:center;justify-content:space-between}
.modal-header h3{font-size:15px;font-weight:700}.modal-body{padding:22px}
.modal-footer{padding:14px 22px;border-top:1px solid var(--sui-dark-border);display:flex;justify-content:flex-end;gap:10px}
.close-btn{background:none;border:none;color:var(--sui-text-muted);cursor:pointer;font-size:18px;padding:4px;line-height:1}.close-btn:hover{color:var(--sui-text)}
.toast{position:fixed;bottom:24px;right:24px;padding:14px 20px;border-radius:var(--radius);background:var(--sui-dark-card);border:1px solid var(--sui-dark-border);font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:200;animation:slideUp .25s ease;display:flex;align-items:center;gap:10px;max-width:360px}
.toast-success{border-color:var(--sui-success)}.toast-error{border-color:var(--sui-error)}
.chart-area{width:100%;height:200px;position:relative;overflow:hidden;border-radius:var(--radius-sm)}.chart-area svg{width:100%;height:100%}
.ptb-pipeline{display:flex;align-items:center;gap:0;flex-wrap:wrap}
.ptb-step{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:var(--radius-sm);border:1px solid var(--sui-dark-border);background:var(--sui-dark);font-size:12px}
.ptb-step.active{border-color:var(--sui-blue);background:var(--sui-blue-dim);color:var(--sui-blue)}
.ptb-step.done{border-color:var(--sui-success);color:var(--sui-success)}
.ptb-arrow{color:var(--sui-text-muted);font-size:16px;padding:0 6px;flex-shrink:0}
.inv-bar{display:flex;height:24px;border-radius:12px;overflow:hidden;background:var(--sui-dark);border:1px solid var(--sui-dark-border)}
.inv-bar-seg{height:100%;transition:width .5s ease}
.event-item{padding:10px 14px;border-bottom:1px solid rgba(26,42,61,0.4);display:flex;align-items:flex-start;gap:10px;font-size:12px}
.event-dot{width:6px;height:6px;border-radius:50%;margin-top:5px;flex-shrink:0}
.note-box{background:rgba(77,162,255,0.05);border:1px solid rgba(77,162,255,0.15);border-radius:var(--radius-sm);padding:12px 14px;font-size:11.5px;color:var(--sui-text-muted);line-height:1.6}
.note-box code{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--sui-blue);background:rgba(77,162,255,0.08);padding:1px 5px;border-radius:3px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}.pulse{animation:pulse 2s infinite}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--sui-dark-border);border-radius:3px}
`;

const Icon = ({ name, size = 16 }) => {
  const icons = {
    dashboard: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
    settings: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
    activity: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
    bot: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>,
    fund: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    github: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.605-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>,
    info: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  };
  return icons[name] || null;
};

const MiniChart = ({ data, color = "var(--sui-blue)", height = 180 }) => {
  if (!data?.length) return null;
  const prices = data.map(d => d.price);
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const w = 600, h = height, pad = 4;
  const points = data.map((d, i) => `${pad + (i / (data.length - 1)) * (w - pad * 2)},${h - pad - ((d.price - min) / range) * (h - pad * 2)}`).join(" ");
  const areaPoints = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;
  return (
    <div className="chart-area" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.15" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <polygon points={areaPoints} fill="url(#cg)" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ position: "absolute", bottom: 6, left: 10, fontSize: 10, color: "var(--sui-text-muted)" }} className="mono">{data[0].price.toFixed(4)}</div>
      <div style={{ position: "absolute", bottom: 6, right: 10, fontSize: 10, color, fontWeight: 600 }} className="mono">{data[data.length - 1].price.toFixed(4)}</div>
    </div>
  );
};

const useToast = () => {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); }, []);
  return [toast, show];
};

export default function PropAMMTerminal() {
  const [page, setPage] = useState("dashboard");
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, showToast] = useToast();
  const [priceHistory] = useState(generatePriceHistory);
  const [orders] = useState(generateMockOrders);
  const [trades] = useState(generateTradeHistory);
  const [events] = useState(generateEvents);

  // AMMConfig state — matches actual on-chain struct from manager.move
  const [config, setConfig] = useState({
    base_spread_bps: 25, volatility_spread_bps: 200, use_laser: false, trading_paused: false,
    pyth_price_feed_id: MOCK_PYTH_FEED_ID,
    // PROPOSED: inventory-aware pricing params
    inventory_skew: 50, skew_aggressiveness: 30,
  });

  const [botRunning, setBotRunning] = useState(true);
  const [ptbStep, setPtbStep] = useState(3);
  const [balances] = useState({ sui: 2450.85, usdc: 8320.42 });

  const currentPrice = priceHistory[priceHistory.length - 1]?.price || 3.4267;
  const fairPrice = currentPrice;
  const midPrice = currentPrice + 0.0023;
  const baseInQuote = balances.sui * currentPrice;
  const totalValue = baseInQuote + balances.usdc;
  const baseRatio = baseInQuote / totalValue;
  const quoteRatio = balances.usdc / totalValue;

  const computeSkewedSpread = () => {
    const imbalance = (baseRatio - 0.5) * 2;
    const agg = config.skew_aggressiveness / 100;
    const bidBps = config.base_spread_bps + (imbalance * agg * config.base_spread_bps * (config.inventory_skew - 50) / 50);
    const askBps = config.base_spread_bps - (imbalance * agg * config.base_spread_bps * (config.inventory_skew - 50) / 50);
    return {
      bidPrice: fairPrice * (1 - Math.max(0, bidBps) / 10000),
      askPrice: fairPrice * (1 + Math.max(0, askBps) / 10000),
      bidBps: Math.max(0, bidBps).toFixed(1), askBps: Math.max(0, askBps).toFixed(1),
    };
  };
  const skewed = computeSkewedSpread();
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const eventColor = (type) => type === "QuoteUpdated" ? "var(--sui-blue)" : type.includes("Config") ? "var(--sui-warning)" : "var(--sui-pink)";
  const eventTag = (type) => type === "QuoteUpdated" ? "tag-event" : type.includes("Config") ? "tag-config" : "tag-account";

  const DashboardPage = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--sui-text-muted)" }}>Active Market</span>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--sui-blue)", background: "var(--sui-blue-dim)", padding: "3px 10px", borderRadius: 6 }}>SUI / USDC</span>
        </div>
        <div className="note-box" style={{ padding: "6px 12px", fontSize: 10.5 }}>
          Contract uses <code>Pool&lt;BaseAsset, QuoteAsset&gt;</code> generics — one <code>AMMConfig</code> per market pair
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Pyth Oracle Price</div>
          <div className="stat-value mono" style={{ color: "var(--sui-blue)" }}>${fairPrice.toFixed(4)}</div>
          <div className="stat-sub">feed: {truncAddr(MOCK_PYTH_FEED_ID, 8)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">DeepBook Mid Price</div>
          <div className="stat-value mono">${midPrice.toFixed(4)}</div>
          <div className="stat-sub">Deviation: <span className="mono" style={{ color: "var(--sui-warning)" }}>{((midPrice - fairPrice) / fairPrice * 10000).toFixed(1)}bps</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Spread (bps)</div>
          <div className="stat-value mono">{config.base_spread_bps}<span style={{ fontSize: 14, color: "var(--sui-text-muted)" }}> / {config.volatility_spread_bps}</span></div>
          <div className="stat-sub">base / volatility</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Session PnL</div>
          <div className="stat-value mono" style={{ color: totalPnl >= 0 ? "var(--sui-success)" : "var(--sui-error)" }}>{totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} <span style={{ fontSize: 14 }}>USDC</span></div>
          <div className="stat-sub">{trades.length} fills · {config.trading_paused ? <span style={{ color: "var(--sui-error)" }}>PAUSED</span> : <span style={{ color: "var(--sui-success)" }}>LIVE</span>}</div>
        </div>
      </div>
      <div className="grid-2-1">
        <div className="card">
          <div className="card-header"><h3>SUI/USDC Price (1m)</h3></div>
          <div className="card-body" style={{ padding: 8 }}><MiniChart data={priceHistory} /></div>
        </div>
        <div className="card">
          <div className="card-header"><h3>BalanceManager</h3></div>
          <div className="card-body">
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                <span>SUI <span className="mono" style={{ color: "var(--sui-blue)" }}>{(baseRatio * 100).toFixed(1)}%</span></span>
                <span>USDC <span className="mono" style={{ color: "var(--sui-pink)" }}>{(quoteRatio * 100).toFixed(1)}%</span></span>
              </div>
              <div className="inv-bar"><div className="inv-bar-seg" style={{ width: `${baseRatio * 100}%`, background: "var(--sui-blue)" }} /><div className="inv-bar-seg" style={{ width: `${quoteRatio * 100}%`, background: "var(--sui-pink)" }} /></div>
            </div>
            {[["SUI", balances.sui], ["USDC", balances.usdc]].map(([l, v]) => (<div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontSize: 12, color: "var(--sui-text-muted)" }}>{l}</span><span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{v.toLocaleString()}</span></div>))}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--sui-dark-border)", paddingTop: 10, marginTop: 4 }}><span style={{ fontSize: 12, color: "var(--sui-text-muted)" }}>Total (USDC eq.)</span><span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>${totalValue.toFixed(2)}</span></div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => setModal("fund")}>Deposit</button>
              <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => setModal("defund")}>Withdraw</button>
            </div>
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>Active Orders ({orders.length})</h3><span style={{ fontSize: 10, color: "var(--sui-text-muted)" }}>2 bids + 2 asks via refresh_quotes</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            <table><thead><tr><th>#</th><th>Side</th><th>Price</th><th>Size</th><th>Status</th></tr></thead>
              <tbody>{orders.map((o, i) => (<tr key={i}><td className="mono" style={{ fontSize: 11, color: "var(--sui-text-muted)" }}>{o.clientOrderId}</td><td><span className={`tag tag-${o.side.toLowerCase()}`}>{o.side}</span></td><td className="mono">${o.price.toFixed(4)}</td><td className="mono">{o.size}</td><td><span className="tag tag-open">{o.status}</span></td></tr>))}</tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Event Feed</h3></div>
          <div className="card-body" style={{ padding: 0, maxHeight: 280, overflowY: "auto" }}>
            {events.map((e, i) => (
              <div className="event-item" key={i}>
                <div className="event-dot" style={{ background: eventColor(e.type) }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span className={`tag ${eventTag(e.type)}`} style={{ fontSize: 10 }}>{e.type}</span><span className="mono" style={{ fontSize: 10, color: "var(--sui-text-muted)" }}>{formatTime(e.ts)}</span></div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--sui-text-muted)", marginTop: 4 }}>{typeof e.data === "object" ? Object.entries(e.data).map(([k, v]) => `${k}=${truncAddr(String(v), 6)}`).join(" · ") : e.data}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const ConfigPage = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>AMMConfig</h3>{connected && <span className="tag" style={{ background: "var(--sui-success-dim)", color: "var(--sui-success)", fontSize: 10 }}>AMMAdminCap ✓</span>}</div>
          <div className="card-body">
            <div className="form-group"><label className="form-label">base_spread_bps</label><div className="slider-wrap"><input type="range" min="1" max="500" value={config.base_spread_bps} onChange={e => setConfig(c => ({ ...c, base_spread_bps: +e.target.value }))} /><span className="slider-val mono">{config.base_spread_bps}</span></div><div className="form-hint">Must be &gt; 0 and ≤ volatility_spread_bps. Default: 25</div></div>
            <div className="form-group"><label className="form-label">volatility_spread_bps</label><div className="slider-wrap"><input type="range" min="1" max="10000" value={config.volatility_spread_bps} onChange={e => setConfig(c => ({ ...c, volatility_spread_bps: +e.target.value }))} /><span className="slider-val mono">{config.volatility_spread_bps}</span></div><div className="form-hint">Outer spread. Must be ≥ base_spread_bps and ≤ 10000. Default: 200</div></div>
            <div className="toggle-row"><div><div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--sui-text-muted)" }}>use_laser</div><div className="form-hint" style={{ marginTop: 2 }}>Enable LASER pricing mode</div></div><div className={`toggle ${config.use_laser ? "on" : ""}`} onClick={() => setConfig(c => ({ ...c, use_laser: !c.use_laser }))} /></div>
            <div className="toggle-row" style={{ borderTop: "1px solid var(--sui-dark-border)", paddingTop: 12, marginTop: 4 }}><div><div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--sui-text-muted)" }}>trading_paused</div><div className="form-hint" style={{ marginTop: 2 }}>Halt refresh_quotes execution</div></div><div className={`toggle ${config.trading_paused ? "on" : ""}`} onClick={() => setConfig(c => ({ ...c, trading_paused: !c.trading_paused }))} /></div>
            <div className="form-group" style={{ marginTop: 16 }}><label className="form-label">pyth_price_feed_id</label><input className="form-input" value={config.pyth_price_feed_id} onChange={e => setConfig(c => ({ ...c, pyth_price_feed_id: e.target.value }))} placeholder="0x... (32 bytes)" /><div className="form-hint">32-byte Pyth Network feed identifier (hex)</div></div>
          </div>
        </div>
        <div className="card" style={{ borderColor: "rgba(254,139,194,0.25)" }}>
          <div className="card-header"><h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>Inventory-Aware Pricing<span className="tag" style={{ background: "var(--sui-pink-dim)", color: "var(--sui-pink)", fontSize: 10 }}>PROPOSED</span></h3></div>
          <div className="card-body">
            <div style={{ fontSize: 12, color: "var(--sui-text-muted)", marginBottom: 16, lineHeight: 1.6 }}>Asymmetric bid/ask placement based on inventory imbalance. Currently <code style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "var(--sui-blue)" }}>refresh_quotes</code> splits balances 50/50 between inner and outer orders. This feature would skew that split based on the base/quote ratio.</div>
            <div className="form-group"><label className="form-label">Skew Direction</label><div className="slider-wrap"><span style={{ fontSize: 11, color: "var(--sui-success)" }}>Buy</span><input type="range" min="0" max="100" value={config.inventory_skew} onChange={e => setConfig(c => ({ ...c, inventory_skew: +e.target.value }))} /><span style={{ fontSize: 11, color: "var(--sui-error)" }}>Sell</span></div><div className="form-hint">{config.inventory_skew === 50 ? "Neutral — symmetric (current behavior)" : config.inventory_skew < 50 ? `Buy bias (${50 - config.inventory_skew}%) — tighter bids` : `Sell bias (${config.inventory_skew - 50}%) — tighter asks`}</div></div>
            <div className="form-group"><label className="form-label">Aggressiveness</label><div className="slider-wrap"><input type="range" min="0" max="100" value={config.skew_aggressiveness} onChange={e => setConfig(c => ({ ...c, skew_aggressiveness: +e.target.value }))} /><span className="slider-val mono">{config.skew_aggressiveness}%</span></div><div className="form-hint">0% = no adjustment, 100% = maximum rebalancing</div></div>
            <div style={{ background: "var(--sui-dark)", borderRadius: "var(--radius-sm)", padding: 14, marginTop: 8, border: "1px solid var(--sui-dark-border)" }}>
              <div style={{ fontSize: 11, color: "var(--sui-text-muted)", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Quote Preview</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div><div style={{ fontSize: 10, color: "var(--sui-success)", fontWeight: 600 }}>BID (inner)</div><div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--sui-success)" }}>${skewed.bidPrice.toFixed(4)}</div><div className="mono" style={{ fontSize: 10, color: "var(--sui-text-muted)" }}>{skewed.bidBps}bps</div></div>
                <div style={{ textAlign: "center", alignSelf: "center" }}><div style={{ fontSize: 10, color: "var(--sui-text-muted)" }}>Mid</div><div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>${fairPrice.toFixed(4)}</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "var(--sui-error)", fontWeight: 600 }}>ASK (inner)</div><div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--sui-error)" }}>${skewed.askPrice.toFixed(4)}</div><div className="mono" style={{ fontSize: 10, color: "var(--sui-text-muted)" }}>{skewed.askBps}bps</div></div>
              </div>
              <div style={{ position: "relative", height: 6, background: "var(--sui-dark-border)", borderRadius: 3, marginTop: 8 }}>
                <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", width: 2, height: 6, background: "var(--sui-text-muted)" }} />
                <div style={{ position: "absolute", left: `${50 - parseFloat(skewed.bidBps) / 2}%`, width: `${parseFloat(skewed.bidBps) / 2}%`, height: 6, background: "var(--sui-success)", borderRadius: "3px 0 0 3px", opacity: 0.6 }} />
                <div style={{ position: "absolute", left: "50%", width: `${parseFloat(skewed.askBps) / 2}%`, height: 6, background: "var(--sui-error)", borderRadius: "0 3px 3px 0", opacity: 0.6 }} />
              </div>
            </div>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--sui-text-muted)" }}><span>Inventory</span><span className="mono">SUI {(baseRatio * 100).toFixed(0)}% / USDC {(quoteRatio * 100).toFixed(0)}%</span></div>
            <div className="inv-bar" style={{ marginTop: 6 }}><div className="inv-bar-seg" style={{ width: `${baseRatio * 100}%`, background: "var(--sui-blue)" }} /><div className="inv-bar-seg" style={{ width: `${quoteRatio * 100}%`, background: "var(--sui-pink)" }} /></div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" onClick={() => { if (!connected) { showToast("Connect wallet first", "error"); return; } showToast("update_amm_config PTB submitted"); }}><Icon name="check" size={14} /> Update Config (PTB)</button>
        <button className="btn btn-ghost" onClick={() => setConfig(c => ({ ...c, base_spread_bps: 25, volatility_spread_bps: 200, use_laser: false, trading_paused: false, inventory_skew: 50, skew_aggressiveness: 30 }))}>Reset Defaults</button>
      </div>
      <div className="card">
        <div className="card-header"><h3>On-chain Objects</h3></div>
        <div className="card-body"><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
          {[["AMMConfig (shared)", MOCK_AMM_CONFIG_ID], ["AMMAdminCap (owned)", MOCK_ADMIN_CAP_ID], ["Package ID", MOCK_PACKAGE_ID], ["TraderAccount (owned)", MOCK_TRADER_ACCOUNT_ID], ["BalanceManager", MOCK_BALANCE_MANAGER_ID], ["DeepBook Registry", MOCK_DEEPBOOK_REGISTRY_ID]].map(([l, id]) => (<div key={l}><span style={{ color: "var(--sui-text-muted)" }}>{l}</span><div className="mono" style={{ marginTop: 2 }}>{truncAddr(id, 8)}</div></div>))}
        </div></div>
      </div>
    </div>
  );

  const PerformancePage = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat-card"><div className="stat-label">Total PnL</div><div className="stat-value mono" style={{ color: totalPnl >= 0 ? "var(--sui-success)" : "var(--sui-error)" }}>{totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}</div><div className="stat-sub">USDC</div></div>
        <div className="stat-card"><div className="stat-label">Win Rate</div><div className="stat-value mono">{((trades.filter(t => t.pnl > 0).length / trades.length) * 100).toFixed(0)}%</div><div className="stat-sub">{trades.filter(t => t.pnl > 0).length}/{trades.length}</div></div>
        <div className="stat-card"><div className="stat-label">Avg Fill</div><div className="stat-value mono">${(trades.reduce((s, t) => s + t.price, 0) / trades.length).toFixed(4)}</div></div>
        <div className="stat-card"><div className="stat-label">Volume</div><div className="stat-value mono">{trades.reduce((s, t) => s + t.qty, 0).toLocaleString()}</div><div className="stat-sub">SUI</div></div>
      </div>
      <div className="card"><div className="card-header"><h3>Trade History</h3></div><div className="card-body" style={{ padding: 0 }}>
        <table><thead><tr><th>Digest</th><th>Side</th><th>Price</th><th>Qty</th><th>PnL</th><th>Time</th></tr></thead>
          <tbody>{trades.map((t, i) => (<tr key={i}><td className="mono" style={{ fontSize: 12 }}>{t.digest}</td><td><span className={`tag tag-${t.side.toLowerCase()}`}>{t.side}</span></td><td className="mono">${t.price.toFixed(4)}</td><td className="mono">{t.qty}</td><td className="mono" style={{ color: t.pnl >= 0 ? "var(--sui-success)" : "var(--sui-error)" }}>{t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}</td><td className="mono" style={{ color: "var(--sui-text-muted)", fontSize: 11 }}>{formatTime(t.ts)}</td></tr>))}</tbody>
        </table></div></div>
    </div>
  );

  const BotPage = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h3>refresh_quotes Bot</h3><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="pulse" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: botRunning ? "var(--sui-success)" : "var(--sui-error)" }} /><span style={{ fontSize: 12, color: botRunning ? "var(--sui-success)" : "var(--sui-error)" }}>{botRunning ? "Running" : "Stopped"}</span></div></div>
          <div className="card-body">
            <div style={{ fontSize: 12, color: "var(--sui-text-muted)", marginBottom: 16 }}>Calls <code style={{ fontFamily: "'JetBrains Mono'", fontSize: 11, color: "var(--sui-blue)" }}>executor::refresh_quotes&lt;SUI, LocalMockUsd&gt;</code> in a loop.</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <button className={`btn ${botRunning ? "btn-danger" : "btn-success"} btn-sm`} onClick={() => { setBotRunning(!botRunning); showToast(botRunning ? "Bot stopped" : "Bot started"); }}>{botRunning ? "Stop" : "Start"}</button>
              <button className="btn btn-outline btn-sm" onClick={() => { setPtbStep(0); let i = 0; const iv = setInterval(() => { i++; setPtbStep(i); if (i >= 4) clearInterval(iv); }, 600); showToast("Manual refresh triggered"); }}><Icon name="refresh" size={13} /> Refresh Now</button>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--sui-text-muted)", marginBottom: 10 }}>PTB Pipeline</div>
            <div className="ptb-pipeline">
              {["get_price_no_older_than", "cancel_all_orders", "withdraw_settled", "place_limit ×4"].map((step, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center" }}>
                  <div className={`ptb-step ${i < ptbStep ? "done" : i === ptbStep ? "active" : ""}`}>
                    {i < ptbStep ? <Icon name="check" size={12} /> : <span className="mono" style={{ fontSize: 10, opacity: 0.5 }}>{i + 1}</span>}
                    <span className="mono" style={{ fontSize: 11 }}>{step}</span>
                  </div>
                  {i < 3 && <span className="ptb-arrow">→</span>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 18, display: "flex", gap: 24, fontSize: 12 }}>
              <div><span style={{ color: "var(--sui-text-muted)" }}>Order expiry:</span> <span className="mono">30s</span></div>
              <div><span style={{ color: "var(--sui-text-muted)" }}>Max price age:</span> <span className="mono">30s</span></div>
              <div><span style={{ color: "var(--sui-text-muted)" }}>Self-match:</span> <span className="mono">cancel_taker</span></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>executor.move logic</h3></div>
          <div className="card-body" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, background: "var(--sui-dark)", borderRadius: "var(--radius-sm)", padding: 14, border: "1px solid var(--sui-dark-border)", lineHeight: 1.8 }}>
            <div style={{ color: "var(--sui-text-muted)" }}>{"// refresh_quotes<BaseAsset, QuoteAsset>"}</div>
            <div style={{ color: "var(--sui-blue)" }}>assert!(!config.trading_paused());</div><br />
            <div style={{ color: "var(--sui-text)" }}>let mid = deepbook_price(pyth_info, config, clock);</div>
            <div style={{ color: "var(--sui-text)" }}>let base_s = config.base_spread(mid);</div>
            <div style={{ color: "var(--sui-text)" }}>let vol_s = config.volatility_spread(mid);</div><br />
            <div style={{ color: "var(--sui-warning)" }}>bid_inner = mid - base_s (tick-aligned)</div>
            <div style={{ color: "var(--sui-warning)" }}>bid_outer = mid - vol_s</div>
            <div style={{ color: "var(--sui-warning)" }}>ask_inner = mid + base_s</div>
            <div style={{ color: "var(--sui-warning)" }}>ask_outer = mid + vol_s</div><br />
            <div style={{ color: "var(--sui-blue)" }}>pool.cancel_all_orders(...);</div>
            <div style={{ color: "var(--sui-blue)" }}>pool.withdraw_settled_amounts(...);</div>
            <div style={{ color: "var(--sui-success)" }}>try_place_limit_order × 4</div>
          </div>
        </div>
      </div>
    </div>
  );

  const FundingPage = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card"><div className="stat-label">TraderAccount — SUI</div><div className="stat-value mono">{balances.sui.toLocaleString()}</div><div className="stat-sub">≈ ${(balances.sui * currentPrice).toFixed(2)}</div></div>
        <div className="stat-card"><div className="stat-label">TraderAccount — USDC</div><div className="stat-value mono">{balances.usdc.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Total Value</div><div className="stat-value mono">${totalValue.toFixed(2)}</div></div>
      </div>
      <div className="note-box">Uses <code>executor::deposit&lt;T&gt;</code> / <code>executor::withdraw&lt;T&gt;</code> gated by <code>AMMAdminCap</code>. TraderAccount wraps DeepBook <code>BalanceManager</code> with embedded <code>TradeCap</code>, <code>DepositCap</code>, <code>WithdrawCap</code>.</div>
      <div className="grid-2">
        {[["Deposit", "fund"], ["Withdraw", "defund"]].map(([label, action]) => (
          <div className="card" key={action}><div className="card-header"><h3>{label}</h3></div><div className="card-body">
            <div className="form-group"><label className="form-label">Token</label><select className="form-input" style={{ cursor: "pointer" }}><option>SUI</option><option>USDC (LocalMockUsd)</option></select></div>
            <div className="form-group"><label className="form-label">Amount</label><input className="form-input" placeholder="0.00" defaultValue={action === "fund" ? "500" : "250"} /></div>
            {action === "defund" && <div className="form-hint" style={{ marginBottom: 12, color: "var(--sui-warning)" }}>Active orders cancelled via cancel_all before withdrawal</div>}
            <button className={`btn ${action === "fund" ? "btn-primary" : "btn-outline"}`} onClick={() => { if (!connected) { showToast("Connect wallet first", "error"); return; } showToast(`${label} submitted`); }}>{label} (AMMAdminCap)</button>
          </div></div>
        ))}
      </div>
    </div>
  );

  const FundModal = () => (
    <div className="modal-overlay" onClick={() => setModal(null)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{modal === "fund" ? "Deposit" : "Withdraw"}</h3><button className="close-btn" onClick={() => setModal(null)}>×</button></div>
        <div className="modal-body">
          <div className="form-group"><label className="form-label">Token</label><select className="form-input"><option>SUI</option><option>USDC (LocalMockUsd)</option></select></div>
          <div className="form-group"><label className="form-label">Amount</label><input className="form-input" placeholder="0.00" autoFocus /></div>
          {modal === "defund" && <div className="form-hint" style={{ color: "var(--sui-warning)" }}>Active orders cancelled before withdrawal</div>}
        </div>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => { if (!connected) { showToast("Connect wallet first", "error"); setModal(null); return; } showToast(modal === "fund" ? "Deposit confirmed" : "Withdrawal confirmed"); setModal(null); }}>{modal === "fund" ? "Deposit" : "Withdraw"}</button></div>
      </div>
    </div>
  );

  const pages = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "config", label: "Configuration", icon: "settings" },
    { id: "performance", label: "Performance", icon: "activity" },
    { id: "bot", label: "Bot Status", icon: "bot" },
    { id: "funding", label: "Funding", icon: "fund" },
  ];
  const pageLabels = { dashboard: "AMM Dashboard", config: "AMMConfig · Update", performance: "Performance Tracker", bot: "Maintenance Bot", funding: "Liquidity Management" };

  return (
    <>
      <style>{CSS}</style>
      <div className="app-shell">
        <div className="sidebar">
          <div className="sidebar-logo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#4DA2FF" strokeWidth="2" /><path d="M8 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#4DA2FF" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="8" r="1.5" fill="#4DA2FF" /></svg><span><span className="accent">Prop</span>AMM</span></div>
          <div className="sidebar-nav">
            <div className="nav-section">Terminal</div>
            {pages.map(p => (<div key={p.id} className={`nav-item ${page === p.id ? "active" : ""}`} onClick={() => setPage(p.id)}><Icon name={p.icon} size={16} />{p.label}</div>))}
          </div>
          <div className="sidebar-footer"><div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Icon name="github" size={13} /><a href="https://github.com/OpenZeppelin/openzeppelin-sui-amm" target="_blank" rel="noopener">openzeppelin-sui-amm</a></div><div>Powered by <span style={{ color: "var(--sui-blue)", fontWeight: 600 }}>Sui</span> · DeepBook V3 · Pyth</div></div>
        </div>
        <div className="main">
          <div className="topbar">
            <div className="topbar-title">{pageLabels[page]}</div>
            <div className="topbar-right">
              <span style={{ fontSize: 11, color: "var(--sui-text-muted)", background: "var(--sui-dark)", padding: "3px 8px", borderRadius: 4, border: "1px solid var(--sui-dark-border)" }}>localnet</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--sui-blue)" }}>${currentPrice.toFixed(4)}</span>
              <button className={`wallet-btn ${connected ? "connected" : ""}`} onClick={() => setConnected(!connected)}><div className={`wallet-dot ${connected ? "on" : "off"}`} />{connected ? truncAddr(MOCK_WALLET, 4) : "Connect Wallet"}</button>
            </div>
          </div>
          <div className="content">{{ dashboard: <DashboardPage />, config: <ConfigPage />, performance: <PerformancePage />, bot: <BotPage />, funding: <FundingPage /> }[page]}</div>
        </div>
      </div>
      {modal && <FundModal />}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.type === "success" ? <Icon name="check" size={16} /> : <Icon name="info" size={16} />}<span>{toast.msg}</span></div>}
    </>
  );
}
