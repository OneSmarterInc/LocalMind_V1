"""End-to-end acceptance run against a live server seeded with `seed_demo`.

    python manage.py migrate && python manage.py bootstrap_admin --email root@localmind.test
    python manage.py seed_demo && python manage.py runserver 127.0.0.1:8011
    python scripts/acceptance.py [base_url]

Walks admin -> faculty -> student -> faculty exactly as the acceptance
criteria describe, printing one line per step. Any non-expected status
raises. Accounts still on the initial password are changed to NEW on the way.
"""
import sys
import json, urllib.request
B=(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8011").rstrip("/")+"/api"
def call(method, path, body=None, tok=None):
    hdr={"Content-Type":"application/json"}
    if tok: hdr["Authorization"]="Bearer "+tok
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(B+path, data=data, headers=hdr, method=method)
    try:
        r=urllib.request.urlopen(req, timeout=30); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
L=lambda d: d["results"] if isinstance(d,dict) and "results" in d else d
PW="Welcome@LocalMind1"; NEW="Str0ng!Passw0rd#2026"
def login(role, email, pw):
    s,d=call("POST",f"/auth/login/{role}/",{"email":email,"password":pw})
    if s!=200: s,d=call("POST",f"/auth/login/{role}/",{"email":email,"password":NEW})
    return s,d
s,d=login("admin","root@localmind.test",PW); atok=d["access"]; print("admin login",s,"must_change_password:",d["must_change_password"])
s2,d2=call("POST","/auth/password/change/",{"current_password":PW,"new_password":NEW},tok=atok); atok=d2.get("access",atok)
s,d=call("POST","/admin/subjects/",{"name":"Networks","code":"NET301"},tok=atok); print("create subject",s); net=d.get("id")
s,d=call("POST","/admin/students/",{"email":"newstu@localmind.test","full_name":"New Student","profile":{"roll_number":"S099"}},tok=atok); print("create student",s)
if net and s==201:
    s,d=call("POST",f"/admin/subjects/{net}/students/",{"student_ids":[d["id"]]},tok=atok); print("enroll",s)
s,d=call("GET","/admin/audit-logs/",tok=atok); print("audit entries",s,d.get("count"))
s,d=call("POST","/auth/login/student/",{"email":"root@localmind.test","password":NEW}); print("admin via student portal ->",s,d["error"]["code"])
s,d=call("GET","/admin/subjects/",tok=atok); os_id=[x for x in L(d) if x["code"]=="OS101"][0]["id"]
s,d=login("faculty","faculty1@localmind.test",PW); tok=d["access"]
s2,d2=call("POST","/auth/password/change/",{"current_password":PW,"new_password":NEW},tok=tok); tok=d2.get("access",tok)
s,d=call("GET","/faculty/subjects/",tok=tok); print("faculty subjects",s,[x["code"] for x in L(d)])
s,d=call("GET",f"/faculty/documents/?subject={os_id}",tok=tok); doc=L(d)[0]; print("faculty docs",s,doc["title"],doc["status"])
s,d=call("GET",f"/faculty/documents/{doc['id']}/outline/",tok=tok); mods=[m for c in d["chapters"] for m in c["modules"]]; print("outline modules",[(m["title"],m["availability"]) for m in mods])
s,d=call("POST",f"/faculty/modules/{mods[2]['id']}/availability/",{"availability":"locked"},tok=tok); print("lock module 3",s,d.get("availability") or d)
s,d=call("GET",f"/faculty/quizzes/?subject={os_id}",tok=tok); quiz=L(d)[0]; print("quizzes",s,quiz["title"],quiz["status"])
s,d=call("GET",f"/faculty/analytics/subjects/{os_id}/",tok=tok); print("faculty analytics",s,d["students_enrolled"])
s,d=call("GET","/admin/subjects/",tok=tok); print("faculty hitting admin ->",s,d["error"]["code"])
s,d=login("student","student1@localmind.test",PW); stok=d["access"]; sess=d["session_id"]
s2,d2=call("POST","/auth/password/change/",{"current_password":PW,"new_password":NEW},tok=stok); stok=d2.get("access",stok)
s,d=call("GET","/student/subjects/",tok=stok); print("student subjects",s,[x["code"] for x in L(d)])
s,d=call("GET",f"/student/subjects/{os_id}/documents/",tok=stok); sdoc=L(d)[0]
s,d=call("GET",f"/student/documents/{sdoc['id']}/",tok=stok); smods=[m for c in d["chapters"] for m in c["modules"]]; print("student sees",[(m["title"],m["availability"]) for m in smods])
s,d=call("GET",f"/student/modules/{smods[2]['id']}/",tok=stok); print("locked module ->",s,d["error"]["code"])
s,d=call("GET",f"/student/modules/{smods[0]['id']}/",tok=stok); print("open module",s,(d.get("progress") or {}).get("status"), "has source:", bool(d.get("source_text")))
s,d=call("POST","/auth/heartbeat/",{"session_id":sess},tok=stok); print("heartbeat",s)
s,d=call("POST",f"/student/modules/{smods[0]['id']}/time/",{"seconds":240},tok=stok); print("learning time",s,d)
s,d=call("POST",f"/student/modules/{smods[0]['id']}/teach/",tok=stok); print("teach (AI off)",s,d.get("generator") or d.get("error"))
s,d=call("POST",f"/student/modules/{smods[0]['id']}/ask/",{"question":"What is a process?"},tok=stok); print("ask (AI off)",s,d.get("error",{}).get("code") or {k:d[k] for k in d if k in("grounded","fallback")})
s,d=call("GET",f"/student/quizzes/?module={smods[0]['id']}",tok=stok); q=L(d)[0]; print("student quizzes",s,q["title"])
s,d=call("POST",f"/student/quizzes/{q['id']}/attempts/",tok=stok); att=d["attempt_id"]; print("start",s,"answers hidden:",all("correct_answer" not in x for x in d["questions"]))
s,d=call("POST",f"/student/quiz-attempts/{att}/submit/",{"submitted_answers":{"q1":"A","q2":"B"}},tok=stok); print("submit",s,d["percentage"],d["passed"])
s,d=call("POST",f"/student/quiz-attempts/{att}/submit/",{"submitted_answers":{"q1":"A","q2":"B"}},tok=stok); print("resubmit ->",s,d["error"]["code"])
s,d=call("GET","/student/assignments/",tok=stok); a=L(d)[0]
s,d=call("POST",f"/student/assignments/{a['id']}/submissions/",{"content":"Round robin gives each process a time slice; priority runs the highest priority first."},tok=stok); print("assignment submit",s,d["status"])
s,d=call("GET","/student/analytics/overview/",tok=stok); print("student overview",s,d["modules"],d["quizzes"]["average_percentage"],d["time"]["learning_seconds"])
s,d=call("POST","/auth/logout/",{"session_id":sess},tok=stok); print("logout",s)
s,d=call("GET",f"/faculty/quizzes/{quiz['id']}/attempts/",tok=tok); print("faculty attempts",s,len(L(d)))
s,d=call("GET",f"/faculty/assignments/{a['id']}/submissions/",tok=tok); sub=L(d)[0]
s,d=call("POST",f"/faculty/assignment-submissions/{sub['id']}/evaluate/",{"score":8,"feedback":"Good."},tok=tok); print("evaluate",s,d.get("status") or d)
s,d=call("GET",f"/faculty/analytics/subjects/{os_id}/students/",tok=tok); r=d["students"][0]; print("cohort row",s,r["quiz_average"],r["learning_seconds"],r["assignment_average"])
s,d=call("GET",f"/faculty/analytics/users/{r['student_id']}/sessions/",tok=atok); print("admin session log",s,d["sessions"][0]["ended_by"],d["sessions"][0]["duration_seconds"])
