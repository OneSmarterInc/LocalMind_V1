import time
def login(role, email, pw="Demo@12345"):
    req=urllib.request.Request(B+f"/auth/login/{role}/", method="POST", data=json.dumps({"email":email,"password":pw}).encode(), headers={"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req).read())["access"]
toks["faculty"]=login("faculty","faculty1@localmind.test"); toks["s3"]=login("student","student3@localmind.test"); toks["admin"]=login("admin","admin@localmind.test")
st=json.load(open("/tmp/state_ids.json"))
mcq={"type":"mcq","question":"Which runs next?","options":[{"key":k,"text":t} for k,t in zip("ABCD",["The chosen ready process","A file","A page","A socket"])],"correct_answer":"A"}
qz=call("/faculty/quizzes/","faculty","POST",{"module_id":st["m1"],"title":f"Release flow quiz {int(time.time())%1000}","questions":[mcq],"results_release":"held"}); call(f"/faculty/quizzes/{qz['id']}/status/","faculty","POST",{"status":"published"})
a=call(f"/student/quizzes/{qz['id']}/attempts/","s3","POST",{}); held=call(f"/student/quiz-attempts/{a['attempt_id']}/submit/","s3","POST",{"submitted_answers":{a["questions"][0]["id"]:"A"}})
new=call("/admin/students/","admin","POST",{"email":f"newcomer{int(time.time())}@localmind.test","full_name":"New Comer","profile":{}})
st.update({"held_attempt": held["id"], "held_quiz": qz["id"], "new_email": new["email"], "new_password": "Welcome@LocalMind1"})
json.dump(st, open("/tmp/state_ids.json","w")); print(st)
