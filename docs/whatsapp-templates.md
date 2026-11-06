# WhatsApp message templates (for Meta approval)

DineSense sends **utility** templates only (no marketing until M11). Register each in WhatsApp Manager in English
(`en`) and Hindi (`hi`), category **Utility**, with the footer _"Reply STOP to stop WhatsApp messages."_ The
body texts are the `whatsapp.*` entries in `packages/i18n/messages/{en,hi}.json`; variables are numbered in the
order of `MESSAGE_VARIABLES` (`packages/shared/src/booking/waitlist.ts`).

| Template name          | Variables ({{1}} …)                   | Sent when                                              |
| ---------------------- | ------------------------------------- | ------------------------------------------------------ |
| `ds_booking_confirmed` | name, outlet, party, date, time, link | Booking made (online or by staff)                      |
| `ds_booking_changed`   | name, outlet, party, date, time, link | Time or party size changed                             |
| `ds_booking_reminder`  | name, outlet, time, link              | `bookingReminderMinutes` before the booking (def. 2 h) |
| `ds_waitlist_joined`   | name, outlet, position, wait, link    | Guest joins the waitlist                               |
| `ds_table_ready`       | name, outlet, table, minutes          | Host taps "Table ready"                                |

Rules enforced by the API: a message is queued only when the guest opted in to WhatsApp (consent `WHATSAPP`),
re-checked at send time; one message per purpose and booking/queue entry; replying STOP withdraws the consent
for that number; the phone is removed from the message log when the guest's data is erased.
