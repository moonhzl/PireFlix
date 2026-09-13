-- Mantém os usuários e cobranças legadas do antigo slug family funcionais,
-- migrando-os para o slug canônico standard (nome exibido: Padrão).
update public.users set plan = 'standard' where plan = 'family';
update public.payments set plan = 'standard' where plan = 'family';

do $$
begin
    if to_regclass('public.payment_orders') is not null then
        update public.payment_orders set plan = 'standard' where plan = 'family';
    end if;
end $$;
