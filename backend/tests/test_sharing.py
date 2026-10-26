from tests.test_songs import chord, guest, note, person, song


def setup_people():
    isura = person("Isura", "isura@example.com")
    rasika = person("Rasika", "rasika@example.com")
    admin = person("Admin", "admin@example.com", admin=True)
    mine = isura.post("/api/songs", json=song("Malata Bambareku Se", artist="Melantha")).json()["id"]
    return isura, rasika, admin, mine


def pending(admin):
    return admin.get("/api/share-requests").json()["requests"]


def test_the_owner_requests_and_sees_waiting_then_the_admin_approves_it_into_the_global_list():
    isura, _rasika, admin, mine = setup_people()
    sent = isura.post(f"/api/songs/{mine}/share")
    assert sent.status_code == 201 and sent.json()["shareStatus"] == "pending"
    assert isura.get("/api/songs?scope=mine").json()["songs"][0]["shareStatus"] == "pending"
    assert isura.get(f"/api/songs/{mine}").json()["shareStatus"] == "pending"

    [request] = pending(admin)
    assert request["title"] == "Malata Bambareku Se" and request["requesterName"] == "Isura" and request["noteCount"] == 3
    detail = admin.get(f"/api/share-requests/{request['id']}").json()
    assert detail["song"]["notes"][0]["position"] == {"stringNumber": 1, "fret": 0}

    approved = admin.post(f"/api/share-requests/{request['id']}/approve")
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    global_id = approved.json()["globalSongId"]

    # In the global list for everyone (a new song), and the user's own song is still theirs.
    visitor = guest()
    assert any(s["id"] == global_id and s["title"] == "Malata Bambareku Se" for s in visitor.get("/api/songs").json()["songs"])
    assert global_id != mine
    assert isura.get(f"/api/songs/{mine}").json()["shareStatus"] == "approved"
    assert isura.get(f"/api/songs/{global_id}").json()["canEdit"] is False
    assert admin.get(f"/api/songs/{global_id}").json()["canEdit"] is True
    assert pending(admin) == []


def test_changes_to_the_own_song_later_do_not_change_the_global_copy():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    global_id = admin.post(f"/api/share-requests/{pending(admin)[0]['id']}/approve").json()["globalSongId"]
    isura.put(f"/api/songs/{mine}", json=song("My new version"))
    assert guest().get(f"/api/songs/{global_id}").json()["title"] == "Malata Bambareku Se"


def test_the_admin_reviews_the_song_as_it_was_sent():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    isura.put(f"/api/songs/{mine}", json=song("Changed after sending"))
    request = pending(admin)[0]
    assert request["title"] == "Malata Bambareku Se"
    global_id = admin.post(f"/api/share-requests/{request['id']}/approve").json()["globalSongId"]
    assert guest().get(f"/api/songs/{global_id}").json()["title"] == "Malata Bambareku Se"


def test_edit_and_approve_publishes_the_admins_corrected_version():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    fixed = song("Malata Bambareku Se (fixed)", artist="Melantha", notes=[note(0, 2, 3, lyric="Ma"), chord(1, (5, 3), (4, 2), (3, 0), (2, 1), (1, 0), name="C")])
    approved = admin.post(f"/api/share-requests/{pending(admin)[0]['id']}/approve", json=fixed).json()
    published = guest().get(f"/api/songs/{approved['globalSongId']}").json()
    assert published["title"] == "Malata Bambareku Se (fixed)" and published["chordCount"] == 1
    assert published["notes"][0]["lyric"] == "Ma"


def test_edit_and_approve_is_checked_like_any_song():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    bad = song(notes=[{"index": 0, "midi": 70, "position": {"stringNumber": 1, "fret": 0}}])
    request_id = pending(admin)[0]["id"]
    assert admin.post(f"/api/share-requests/{request_id}/approve", json=bad).status_code == 422
    assert len(pending(admin)) == 1  # still waiting, nothing published


def test_reject_with_or_without_a_reason_and_send_again():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    rejected = admin.post(f"/api/share-requests/{pending(admin)[0]['id']}/reject", json={"reason": "  Please add the   words. "})
    assert rejected.json()["status"] == "rejected"
    shown = isura.get(f"/api/songs/{mine}").json()
    assert shown["shareStatus"] == "rejected" and shown["shareReason"] == "Please add the words."
    assert all(s["title"] != "Malata Bambareku Se" for s in guest().get("/api/songs").json()["songs"])

    # Sent again, rejected without a reason.
    assert isura.post(f"/api/songs/{mine}/share").json()["shareStatus"] == "pending"
    assert admin.post(f"/api/share-requests/{pending(admin)[0]['id']}/reject").status_code == 200
    shown = isura.get(f"/api/songs/{mine}").json()
    assert shown["shareStatus"] == "rejected" and shown["shareReason"] is None
    reviewed = admin.get("/api/share-requests?state=reviewed").json()["requests"]
    assert [r["status"] for r in reviewed] == ["rejected", "rejected"]


def test_one_waiting_request_per_song_and_the_owner_can_withdraw_it():
    isura, _rasika, admin, mine = setup_people()
    assert isura.post(f"/api/songs/{mine}/share").status_code == 201
    again = isura.post(f"/api/songs/{mine}/share")
    assert again.status_code == 409 and "already waiting" in again.json()["detail"]
    assert isura.delete(f"/api/songs/{mine}/share").status_code == 204
    assert isura.get(f"/api/songs/{mine}").json()["shareStatus"] is None
    assert pending(admin) == []
    assert isura.delete(f"/api/songs/{mine}/share").status_code == 409


def test_a_request_can_be_reviewed_only_once():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    request_id = pending(admin)[0]["id"]
    assert admin.post(f"/api/share-requests/{request_id}/approve").status_code == 200
    assert admin.post(f"/api/share-requests/{request_id}/approve").status_code == 409
    assert admin.post(f"/api/share-requests/{request_id}/reject").status_code == 409
    assert admin.post("/api/share-requests/not-a-uuid/approve").status_code == 404


def test_only_the_owner_requests_and_only_the_admin_reviews():
    isura, rasika, admin, mine = setup_people()
    assert rasika.post(f"/api/songs/{mine}/share").status_code == 404  # someone else's song is invisible
    assert guest().post(f"/api/songs/{mine}/share").status_code == 401
    assert admin.post("/api/songs/sample-first-frets/share").status_code in (403, 404)
    isura.post(f"/api/songs/{mine}/share")
    request_id = pending(admin)[0]["id"]
    for other in (isura, rasika):
        assert other.get("/api/share-requests").status_code == 403
        assert other.get(f"/api/share-requests/{request_id}").status_code == 403
        assert other.post(f"/api/share-requests/{request_id}/approve").status_code == 403
        assert other.post(f"/api/share-requests/{request_id}/reject").status_code == 403
    assert rasika.delete(f"/api/songs/{mine}/share").status_code == 404


def test_deleting_the_own_song_removes_its_waiting_request():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    isura.delete(f"/api/songs/{mine}")
    assert pending(admin) == []


def test_a_shared_song_cannot_be_shared_again_unless_the_admin_removed_the_global_copy():
    isura, _rasika, admin, mine = setup_people()
    isura.post(f"/api/songs/{mine}/share")
    global_id = admin.post(f"/api/share-requests/{pending(admin)[0]['id']}/approve").json()["globalSongId"]
    again = isura.post(f"/api/songs/{mine}/share")
    assert again.status_code == 409 and again.json()["detail"] == "This song is already shared with everyone."
    # The admin deletes the global copy: the song is no longer shared and may be shared again.
    admin.delete(f"/api/songs/{global_id}")
    assert isura.get(f"/api/songs/{mine}").json()["shareStatus"] is None
    assert isura.post(f"/api/songs/{mine}/share").status_code == 201


def test_api_answers_are_never_stored_by_browsers_or_netlify():
    assert guest().get("/api/songs").headers["cache-control"] == "no-store"
    assert guest().get("/api/health").headers["cache-control"] == "no-store"
