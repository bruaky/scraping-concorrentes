-- ============================================================
-- Título do salto de seguidores sem espaços
-- ============================================================
-- BUG: to_char(n, 'SG999G999') reserva as casas que o número não usa e
-- devolve brancos à esquerda do dígito — o feed mostrava
-- "Strattum: +    238 seguidores". O prefixo FM tira o preenchimento, e
-- o separador de milhar vira ponto (pt-BR) independente do lc_numeric do
-- banco: "+1.608 seguidores". O detalhe ("@x agora com 3930") ganha o
-- mesmo separador.
--
-- A função é a mesma da 0003; só o título e o detalhe do passo 6 mudam.
-- ============================================================

create or replace function fn_generate_change_events(p_run_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_total integer := 0;
    v_n     integer := 0;
    v_run_started timestamptz;
begin
    select started_at into v_run_started from collection_runs where id = p_run_id;

    -- 1. Preço mudou → high
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'pricing_changed', 'high',
        c.name || ': ' || f.field_name || ' passou de '
            || coalesce(f.previous_value, '—') || ' para '
            || coalesce(f.current_value, '—'),
        tp.url,
        jsonb_build_object('ref', f.id::text, 'field', f.field_name,
                           'previous', f.previous_value, 'current', f.current_value),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'pricing'
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 2. Proposta de valor (home) → high
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'value_prop_changed', 'high',
        c.name || ' mudou o posicionamento na home',
        coalesce(f.previous_value, '—') || ' → ' || coalesce(f.current_value, '—'),
        jsonb_build_object('ref', f.id::text, 'field', f.field_name),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'home'
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 3. Vagas → notable
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        f.competitor_id, 'firecrawl', 'page_changed', 'notable',
        c.name || ': vagas de ' || coalesce(f.previous_value, '—')
            || ' para ' || coalesce(f.current_value, '—'),
        tp.url,
        jsonb_build_object('ref', f.id::text, 'field', f.field_name, 'kind', 'careers'),
        f.observed_at
    from page_field_changes f
    join page_scrapes  ps on ps.id = f.scrape_id and ps.run_id = p_run_id
    join tracked_pages tp on tp.id = f.tracked_page_id
    join competitors   c  on c.id  = f.competitor_id
    where f.has_changed and tp.page_type = 'careers'
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 4. Post de blog novo → info (escopado pelo run, não por "última hora")
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        b.competitor_id, 'firecrawl', 'new_blog_post', 'info',
        c.name || ': ' || coalesce(b.title, b.url),
        b.url,
        jsonb_build_object('ref', b.id::text, 'url', b.url),
        b.first_seen_at
    from blog_posts b
    join competitors c on c.id = b.competitor_id
    where not b.is_gone
      and v_run_started is not null
      and b.first_seen_at >= v_run_started
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 5. Página saiu do ar ou dos links → notable, SÓ NA TRANSIÇÃO
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        ps.competitor_id, 'firecrawl',
        case when ps.change_status = 'removed' then 'page_removed' else 'page_hidden' end,
        'notable',
        c.name || ': ' || tp.page_type
            || case when ps.change_status = 'removed'
                    then ' saiu do ar' else ' saiu dos links do site' end,
        tp.url,
        jsonb_build_object('ref', ps.id::text),
        ps.scraped_at
    from page_scrapes ps
    join tracked_pages tp on tp.id = ps.tracked_page_id
    join competitors   c  on c.id  = ps.competitor_id
    left join lateral (
        select p2.change_status, p2.visibility
        from page_scrapes p2
        where p2.tracked_page_id = ps.tracked_page_id
          and p2.scraped_at < ps.scraped_at
        order by p2.scraped_at desc
        limit 1
    ) prev on true
    where ps.run_id = p_run_id
      and (
        -- passou a estar fora do ar agora
        (ps.change_status = 'removed' and coalesce(prev.change_status, '') <> 'removed')
        -- ou passou a estar oculta agora
        or (ps.visibility = 'hidden'
            and coalesce(prev.visibility, 'visible') <> 'hidden'
            and ps.change_status is distinct from 'removed')
      )
      -- sem captura anterior é baseline: não há transição a relatar
      and prev.change_status is not null
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 6. Salto de seguidores → notable acima de 5% ou 500
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        s.competitor_id, 'apify_instagram', 'followers_jump', 'notable',
        c.name || ': ' || replace(to_char(s.followers_count - prev.followers_count, 'FMSG999,999,999'), ',', '.')
            || ' seguidores',
        '@' || s.username || ' agora com '
            || replace(to_char(s.followers_count, 'FM999,999,999'), ',', '.'),
        jsonb_build_object('ref', s.id::text,
                           'from', prev.followers_count, 'to', s.followers_count),
        s.captured_at
    from instagram_profile_snapshots s
    join competitors c on c.id = s.competitor_id
    join lateral (
        select followers_count
        from instagram_profile_snapshots p
        where p.competitor_id = s.competitor_id
          and p.captured_at < s.captured_at
        order by p.captured_at desc
        limit 1
    ) prev on true
    where s.run_id = p_run_id
      and prev.followers_count > 0
      and (
           abs(s.followers_count - prev.followers_count) >= 500
        or abs(100.0 * (s.followers_count - prev.followers_count)
               / prev.followers_count) >= 5
      )
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    -- 7. Bio ou link da bio mudou → notable
    insert into change_events
        (competitor_id, source, event_type, severity, title, detail, payload, occurred_at)
    select
        s.competitor_id, 'apify_instagram',
        case when s.biography is distinct from prev.biography
             then 'bio_changed' else 'bio_link_changed' end,
        'notable',
        -- o título segue o que mudou de verdade
        case when s.biography is distinct from prev.biography
             then c.name || ' mudou a bio do Instagram'
             else c.name || ' mudou o link da bio' end,
        case when s.biography is distinct from prev.biography
             then coalesce(prev.biography, '—') || ' → ' || coalesce(s.biography, '—')
             else coalesce(prev.external_url, '—') || ' → ' || coalesce(s.external_url, '—') end,
        jsonb_build_object('ref', s.id::text,
                           'bio_from', prev.biography, 'bio_to', s.biography,
                           'url_from', prev.external_url, 'url_to', s.external_url),
        s.captured_at
    from instagram_profile_snapshots s
    join competitors c on c.id = s.competitor_id
    join lateral (
        select biography, external_url
        from instagram_profile_snapshots p
        where p.competitor_id = s.competitor_id
          and p.captured_at < s.captured_at
        order by p.captured_at desc
        limit 1
    ) prev on true
    where s.run_id = p_run_id
      and (s.biography   is distinct from prev.biography
        or s.external_url is distinct from prev.external_url)
    on conflict do nothing;
    get diagnostics v_n = row_count; v_total := v_total + v_n;

    return v_total;
end;
$$;
