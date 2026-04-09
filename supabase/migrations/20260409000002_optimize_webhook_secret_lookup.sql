-- Create unique index on stripe_webhook_secret for fast lookups
CREATE UNIQUE INDEX idx_company_payment_secrets_stripe_webhook_secret
ON company_payment_secrets(stripe_webhook_secret)
WHERE stripe_webhook_secret IS NOT NULL;

-- Create index on company_id for additional query optimization
CREATE INDEX idx_company_payment_secrets_company_id ON company_payment_secrets(company_id);

-- Add comments for documentation
COMMENT ON INDEX idx_company_payment_secrets_stripe_webhook_secret IS 'Unique index for fast webhook secret validation (used in stripe-webhook-handler function)';
