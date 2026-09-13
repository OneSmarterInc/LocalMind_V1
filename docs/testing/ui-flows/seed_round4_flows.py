import time
def login(role, email, pw="Demo@12345"):
    req=urllib.request.Request(B+f"/auth/login/{role}/", method="POST", data=json.dumps({"email":email,"password":pw}).encode(), headers={"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req).read())["access"]
toks["faculty"]=login("faculty","faculty1@localmind.test")
st=json.load(open("/tmp/state_ids.json")); m1=st["m1"]; stamp=int(time.time())%100000
mcq=lambda q:{"type":"mcq","question":q,"options":[{"key":k,"text":t} for k,t in zip("ABCD",["The ready process","A file","A page","A socket"])],"correct_answer":"A"}
timed=call("/faculty/quizzes/","faculty","POST",{"module_id":m1,"title":f"Timed {stamp}","questions":[mcq("Which runs next?")],"time_limit_minutes":1}); call(f"/faculty/quizzes/{timed['id']}/status/","faculty","POST",{"status":"published"})
mod=call(f"/faculty/modules/{m1}/","faculty")
chq=call("/faculty/quizzes/","faculty","POST",{"chapter_id":mod["chapter_id"],"title":f"Whole chapter {stamp}","questions":[mcq("Which runs next?")]})
qa=call("/faculty/quizzes/","faculty","POST",{"module_id":m1,"title":f"Switch A {stamp}","questions":[mcq("A question?")]})
qb=call("/faculty/quizzes/","faculty","POST",{"module_id":m1,"title":f"Switch B {stamp}","questions":[mcq("B question?")]})
out={"timed_quiz":timed["id"],"chapter_quiz":chq["id"],"chapter_kind":chq.get("kind"),"quiz_a":qa["id"],"quiz_a_title":qa["title"],"quiz_b":qb["id"],"quiz_b_title":qb["title"],"review_doc":json.load(open("/tmp/cmp_ids.json"))["review_doc"]}
json.dump(out, open("/tmp/r4_ids.json","w")); print(out)
