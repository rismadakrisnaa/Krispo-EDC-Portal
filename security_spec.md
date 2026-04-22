# Security Specification: EDC Management System

## 1. Data Invariants
- EDCs must have a unique Serial Number (SN).
- Contract calculations (Start/End dates) are automated based on movement types (Install/Withdrawal).
- Penalty amounts are strictly calculated server-side (in application logic, but rules must ensure identity integrity).
- Users can only access the system if they have a profile doc matching their UID.
- Roles determine the extent of write access across collections.

## 2. The "Dirty Dozen" (Attack Scenarios)
1. **Identity Spoofing**: A user attempts to create a profile with `role: "Admin"` despite not being authorized.
2. **State Shortcutting**: A user tries to update an EDC status to "Installed / Active" without going through the `movements` log (though rules can't enforce movement-EDC atomicity perfectly without `existsAfter`, we can restrict status updates to specific roles).
3. **Price Manipulation**: A user attempts to change the `price` in `edc_parts` to Rp 0.
4. **Contract Date Forgery**: A user tries to set a backdated `contractStartDate` on an EDC.
5. **Unauthorized Multi-Account Read**: A user tries to read customers they don't have access to (if we had customer-level multi-tenancy, but here it's role-based access to the whole DB).
6. **Shadow Field Injection**: Adding `isVerified: true` to a profile doc.
7. **Resource Poisoning**: Sending a 1MB string as a Serial Number.
8. **Owner Deletion**: A non-admin user trying to delete a customer or EDC record.
9. **Movement Drift**: Updating a movement log after it has been created to hide history.
10. **Role Escalation**: A 'Management' user trying to update their own role to 'Admin'.
11. **Part Penalty Forgery**: Setting a negative `partPenaltyAmount`.
12. **PII Leak**: Unauthorized read of `users` collection.

## 3. Test Runner (Draft Plan)
- Test: `get` on `/users/{otherId}` by non-admin should fail.
- Test: `create` on `/edc_parts` by a 'Service' role should work, but by a 'Warehouse' role should fail (depending on role matrix).
- Test: `update` on `edcs` allowing only specific fields if the role is restricted.
- Test: `delete` on any collection by non-admin should fail.
