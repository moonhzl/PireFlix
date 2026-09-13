-- Checkout PIX sem conta prévia: os dados ficam pendentes até o webhook assinado confirmar o pagamento.
alter table public.users add column if not exists username text;
alter table public.users add column if not exists phone text;
alter table public.users add column if not exists cpf_hash text;
alter table public.users add column if not exists cpf_last2 text;
alter table public.users add column if not exists terms_accepted_at timestamptz;
alter table public.users add column if not exists terms_version text;
alter table public.users add column if not exists updated_at timestamptz;
alter table public.security_logs add column if not exists user_agent text;
create unique index if not exists users_username_unique on public.users (lower(username)) where username is not null;

create table if not exists public.pending_registrations (
    id text primary key,
    transaction_id text not null unique,
    plan text not null,
    amount numeric(12,2) not null,
    name text not null,
    email text not null,
    username text not null,
    password_hash text,
    password_salt text,
    cpf_hash text not null,
    cpf_last2 text not null,
    phone text not null,
    cep text not null,
    street text not null,
    number text not null,
    complement text,
    neighborhood text not null,
    city text not null,
    state text not null,
    signup_ip text,
    signup_user_agent text,
    payment_status text not null default 'pending',
    status text not null default 'pending',
    terms_accepted_at timestamptz not null,
    terms_version text not null,
    user_id bigint unique references public.users(id) on delete restrict,
    completed_at timestamptz,
    expires_at timestamptz not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create unique index if not exists pending_registrations_email_pending_unique on public.pending_registrations (lower(email)) where status = 'pending';
create unique index if not exists pending_registrations_username_pending_unique on public.pending_registrations (lower(username)) where status = 'pending';

create table if not exists public.addresses (
    id text primary key,
    user_id bigint not null unique references public.users(id) on delete cascade,
    cep text not null,
    street text not null,
    number text not null,
    complement text,
    neighborhood text not null,
    city text not null,
    state text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create table if not exists public.subscriptions (
    id text primary key,
    user_id bigint not null references public.users(id) on delete cascade,
    plan text not null,
    status text not null,
    started_at timestamptz not null,
    expires_at timestamptz,
    created_at timestamptz not null,
    updated_at timestamptz not null
);

alter table public.payment_orders alter column user_id drop not null;
alter table public.payment_orders add column if not exists pending_registration_id text unique references public.pending_registrations(id) on delete restrict;

alter table public.pending_registrations enable row level security;
alter table public.addresses enable row level security;
alter table public.subscriptions enable row level security;
revoke all on public.pending_registrations, public.addresses, public.subscriptions from anon, authenticated;
grant all on public.pending_registrations, public.addresses, public.subscriptions to service_role;

-- O webhook chama esta função uma vez. O lock e o transaction_id único tornam a operação idempotente.
create or replace function public.complete_pending_registration(
    p_transaction_id text,
    p_provider_transaction_id text,
    p_paid_at timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_order public.payment_orders%rowtype;
    v_pending public.pending_registrations%rowtype;
    v_user_id bigint;
    v_payment_id bigint;
    v_log_id bigint;
begin
    select * into v_order from public.payment_orders where transaction_id = p_transaction_id for update;
    if not found then raise exception 'Pedido não encontrado'; end if;
    if v_order.pending_registration_id is null then raise exception 'Pedido não é um cadastro pendente'; end if;

    select * into v_pending from public.pending_registrations where id = v_order.pending_registration_id for update;
    if not found then raise exception 'Cadastro pendente não encontrado'; end if;
    if v_pending.status = 'completed' then return v_pending.user_id; end if;
    if v_pending.expires_at <= now() then raise exception 'Cadastro pendente expirado'; end if;
    if v_order.plan <> v_pending.plan or v_order.amount <> v_pending.amount then raise exception 'Plano ou valor do pedido divergente'; end if;

    perform pg_advisory_xact_lock(814202609);
    select coalesce(max(id), 0) + 1 into v_user_id from public.users;
    insert into public.users (
        id, name, username, email, password_hash, password_salt, phone, cpf_hash, cpf_last2,
        plan, subscription_status, status, terms_accepted_at, terms_version, created_at, updated_at
    ) values (
        v_user_id, v_pending.name, v_pending.username, v_pending.email, v_pending.password_hash, v_pending.password_salt,
        v_pending.phone, v_pending.cpf_hash, v_pending.cpf_last2, v_pending.plan, 'active', 'active',
        v_pending.terms_accepted_at, v_pending.terms_version, p_paid_at, p_paid_at
    );

    insert into public.addresses (id, user_id, cep, street, number, complement, neighborhood, city, state, created_at, updated_at)
    values ('address_' || gen_random_uuid(), v_user_id, v_pending.cep, v_pending.street, v_pending.number, v_pending.complement, v_pending.neighborhood, v_pending.city, v_pending.state, p_paid_at, p_paid_at);
    insert into public.subscriptions (id, user_id, plan, status, started_at, created_at, updated_at)
    values ('subscription_' || gen_random_uuid(), v_user_id, v_pending.plan, 'active', p_paid_at, p_paid_at, p_paid_at);

    select coalesce(max(id), 0) + 1 into v_payment_id from public.payments;
    insert into public.payments (id, transaction_id, user_id, plan, amount, status, provider, provider_transaction_id, paid_at, created_at, updated_at)
    values (v_payment_id, v_order.transaction_id, v_user_id, v_order.plan, v_order.amount, 'approved', 'cashinpay', p_provider_transaction_id, p_paid_at, p_paid_at, p_paid_at);

    update public.payment_orders set user_id = v_user_id, status = 'approved', paid_at = p_paid_at, updated_at = p_paid_at where id = v_order.id;
    update public.pending_registrations set user_id = v_user_id, password_hash = null, password_salt = null, payment_status = 'approved', status = 'completed', completed_at = p_paid_at, updated_at = p_paid_at where id = v_pending.id;

    select coalesce(max(id), 0) + 1 into v_log_id from public.security_logs;
    insert into public.security_logs (id, type, user_id, timestamp, ip, user_agent, details)
    values (v_log_id, 'ACCOUNT_CREATED_AFTER_PIX', v_user_id, p_paid_at, v_pending.signup_ip, v_pending.signup_user_agent, 'Conta ativada após confirmação de pagamento PIX.');

    return v_user_id;
end;
$$;

create or replace function public.expire_pending_registrations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    with expired as (
        update public.pending_registrations
        set status = 'expired', payment_status = 'expired', updated_at = now()
        where status = 'pending' and expires_at <= now()
        returning id
    )
    update public.payment_orders
    set status = 'expired', updated_at = now()
    where pending_registration_id in (select id from expired);
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

-- Rotina manual/agendável: remove cadastros que expiraram há mais de 30 dias e nunca viraram conta.
create or replace function public.cleanup_expired_pending_registrations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    delete from public.payment_orders
    where pending_registration_id in (
        select id from public.pending_registrations
        where status in ('expired', 'failed') and user_id is null and updated_at < now() - interval '30 days'
    );
    delete from public.pending_registrations
    where status in ('expired', 'failed') and user_id is null and updated_at < now() - interval '30 days';
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

revoke all on function public.complete_pending_registration(text, text, timestamptz) from public;
revoke all on function public.expire_pending_registrations() from public;
revoke all on function public.cleanup_expired_pending_registrations() from public;
grant execute on function public.complete_pending_registration(text, text, timestamptz) to service_role;
grant execute on function public.expire_pending_registrations() to service_role;
grant execute on function public.cleanup_expired_pending_registrations() to service_role;
