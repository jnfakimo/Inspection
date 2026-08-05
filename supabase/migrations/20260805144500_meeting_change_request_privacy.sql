-- 變更申請僅供申請者與原預約人讀取。

drop policy if exists "meeting_change_authenticated_select" on public.meeting_booking_change_requests;
create policy "meeting_change_authenticated_select"
  on public.meeting_booking_change_requests for select to authenticated using (
    requester_id in (
      select user_id from public.users where auth_id=auth.uid() and status='active'
    )
    or exists (
      select 1 from public.meeting_bookings b
      join public.users u on u.user_id=b.user_id
      where b.booking_id=target_booking_id and u.auth_id=auth.uid() and u.status='active'
    )
  );
