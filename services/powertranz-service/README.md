# Powertranz Service

This service is the Powertranz payment service for this repo. It follows the same style as the Stripe service and uses API Gateway + Lambda.

## What it does

- Handles Powertranz routes
- Has a simple health route for smoke testing
- Uses the same build and package setup as the other services

## Routes

- `GET /powertranz/health`
- `POST /powertranz/payment-intents`
- `GET /powertranz/invoices`
- `POST /powertranz/callback`

## Payment flow

1. `POST /powertranz/payment-intents` creates a PowerTranz hosted-page Auth SPI token for a TTD one-time product.
2. The client renders/submits the returned `hostedPaymentPageHtml` (also available as `redirectData`) so the buyer can finish the hosted-page and 3DS steps. Do not redirect the buyer directly to `/powertranz/callback`; that URL is only the PowerTranz `MerchantResponseUrl`.
3. PowerTranz posts the browser return to `/powertranz/callback`.
4. The callback handler posts the SPI token to `/api/spi/payment`, then calls `/api/capture`; approved `00` responses mark the intent complete and publish the billing event.
5. The callback redirects the browser to `/billing?payment=success` when payment completes, or `/billing?payment=cancel` when the callback cannot be completed. Both redirects include `spiToken`, and when known they also include `transactionIdentifier` and `orderIdentifier`.
6. `GET /powertranz/invoices` returns the authenticated user's PowerTranz invoice/payment records, including `paidAt`, failure metadata, and response codes for billing UI lookup.

## Environment

- `POWERTRANZ_BASE_URL`
- `POWERTRANZ_MERCHANT_ID`
- `POWERTRANZ_MERCHANT_PASSWORD`
- `POWERTRANZ_CALLBACK_SECRET`
- `POWERTRANZ_MERCHANT_RESPONSE_URL`
- `POWERTRANZ_INTENTS_TABLE_NAME`
- `PRODUCTS_TABLE`
- `PRICES_TABLE`
- `TRANSACTIONS_TABLE`
- `BILLING_EVENTS_TOPIC_ARN`
- `EMAIL_QUEUE_URL`
- `JWT_ACCESS_TOKEN_SECRET`

## Run it

From the repo root:

```bash
npm run build --workspace=@services/powertranz-service
npm run package --workspace=@services/powertranz-service
npm run type-check --workspace=@services/powertranz-service
```

## Test it

Run the smoke test:

```bash
npx jest --config jest.e2e.config.js tests/e2e/powertranz-service.test.ts --runInBand
```

## Notes

- `src/` has the service code.
- `dist/` is the build output.
- `function.zip` is the packaged Lambda file.
