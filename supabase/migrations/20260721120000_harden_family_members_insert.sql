-- F39 (segurança/isolamento): remove a policy de INSERT direto em family_members.
--
-- A policy "Can insert self as member" só validava `user_id = auth.uid()`,
-- permitindo que qualquer usuário autenticado se inserisse — inclusive como
-- role='admin' — em QUALQUER família, bastando conhecer o family_id. Isso
-- quebrava o isolamento: concedia leitura dos profiles (e-mail/nome) da família
-- (via profiles_select_self_or_same_family / is_family_member), rename da
-- família (families_update_admin) e remoção de outros membros
-- (family_members_delete_admin). Um ex-membro removido conseguia se readicionar
-- como admin sem convite.
--
-- Toda entrada legítima em família já ocorre por RPCs SECURITY DEFINER, que
-- rodam com privilégio elevado e NÃO dependem desta policy:
--   create_family(family_name) -> insere o dono como 'admin'
--   join_family(code)          -> valida o invite_code e insere como 'member'
-- Logo, remover a policy fecha o buraco sem quebrar nenhum fluxo suportado.
-- (No banco vivo a policy tem esse nome exato; mantemos os dois nomes históricos
--  por segurança caso o ambiente esteja numa variação do repo.)

drop policy if exists "Can insert self as member" on public.family_members;
drop policy if exists "family_members_insert_self" on public.family_members;
