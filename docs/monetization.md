# Monetização

Estado atual: **desligada**. `feature_flags.monetization_enabled = 0` (seed da migração `0001`), nenhuma rota `/billing/*` ou `/api/billing/*` existe (ambas respondem 404, testado), nenhum SDK de pagamento instalado.

Quando (e se) for habilitada em fase futura, exigiria: tabela de planos, quotas por plano em `usage_quotas`, gateway de pagamento aprovado, rotas de cobrança e revisão de privacidade. Nada disso existe hoje, e nenhuma dessas partes é oferecida na UI.
