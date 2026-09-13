create table if not exists public.payment_orders (
    id text primary key,
    transaction_id text not null unique,
    provider_transaction_id text unique,
    user_id bigint not null references public.users(id) on delete restrict,
    plan text not null,
    amount numeric(12,2) not null,
    status text not null default 'pending',
    pix_qrcode text,
    pix_copy_paste text,
    paid_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create table if not exists public.payment_webhook_events (
    id text primary key,
    provider_event_id text not null unique,
    event_type text not null,
    transaction_id text,
    payload jsonb not null,
    processed_at timestamptz,
    created_at timestamptz not null
);

alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists provider_transaction_id text;
alter table public.payments add column if not exists paid_at timestamptz;
alter table public.payments add column if not exists updated_at timestamptz;

alter table public.payment_orders enable row level security;
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_orders, public.payment_webhook_events from anon, authenticated;
grant all on public.payment_orders, public.payment_webhook_events to service_role;
