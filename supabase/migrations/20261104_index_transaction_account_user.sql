-- Cover the composite foreign key from transactions to accounts.
CREATE INDEX IF NOT EXISTS transactions_account_user_idx
  ON public.transactions (account_id, user_id);
