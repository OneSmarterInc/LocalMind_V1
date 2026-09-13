import time, uuid
def login(role, email, pw="Demo@12345"):
    req=urllib.request.Request(B+f"/auth/login/{role}/", method="POST", data=json.dumps({"email":email,"password":pw}).encode(), headers={"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req).read())["access"]
toks["faculty"]=login("faculty","faculty1@localmind.test"); toks["s1"]=login("student","student1@localmind.test"); toks["s2"]=login("student","student2@localmind.test"); toks["admin"]=login("admin","admin@localmind.test")
st=json.load(open("/tmp/state_ids.json")); ids=json.load(open("/tmp/cmp_ids.json"))
seed=json.loads(open("/tmp/r3_seed.json").read().strip())
m1=st["m1"]; stamp=int(time.time())%100000
mcq=lambda q:{"type":"mcq","question":q,"options":[{"key":k,"text":t} for k,t in zip("ABCD",["The ready process","A file","A page","A socket"])],"correct_answer":"A"}
dq=call("/faculty/quizzes/","faculty","POST",{"module_id":m1,"title":f"Draft restore {stamp}","questions":[mcq("Which runs next?"),mcq("Which is chosen?")]}); call(f"/faculty/quizzes/{dq['id']}/status/","faculty","POST",{"status":"published"})
# held assignment released
ha=call("/faculty/assignments/","faculty","POST",{"module_id":m1,"title":f"Release label {stamp}","max_score":10,"results_release":"held","rubric":[{"criterion":"A","points":10}]}); call(f"/faculty/assignments/{ha['id']}/status/","faculty","POST",{"status":"published"})
sub=call(f"/student/assignments/{ha['id']}/submissions/","s1","POST",{"content":"An answer"})
call(f"/faculty/assignment-submissions/{sub['id']}/evaluate/","faculty","POST",{"score":8,"feedback":"Good"})
rel=call(f"/faculty/assignments/{ha['id']}/release-results/","faculty","POST",{})
# limit assignment used up by student2
la=call("/faculty/assignments/","faculty","POST",{"module_id":m1,"title":f"Limit {stamp}","max_score":10,"allow_resubmission":True,"max_attempts":2,"rubric":[{"criterion":"A","points":10}]}); call(f"/faculty/assignments/{la['id']}/status/","faculty","POST",{"status":"published"})
for c in ("one","two"): call(f"/student/assignments/{la['id']}/submissions/","s2","POST",{"content":c})
# archived book
subs=call("/faculty/subjects/","faculty"); sid=[s for s in subs if s["code"]=="OS101"][0]["id"]
boundary="----lm"+uuid.uuid4().hex
body=b""
for k,v in [("subject_id",sid),("title",f"Archived {stamp}")]:
    body+=f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
body+=f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"arch{stamp}.docx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n".encode()+open("/tmp/networking.docx","rb").read()+f"\r\n--{boundary}--\r\n".encode()
doc=json.loads(urllib.request.urlopen(urllib.request.Request(B+"/faculty/documents/", method="POST", data=body, headers={"Content-Type":f"multipart/form-data; boundary={boundary}","Authorization":"Bearer "+toks["faculty"]})).read())
call(f"/faculty/documents/{doc['id']}/process/","faculty","POST",{})
for i in range(30):
    d=call(f"/faculty/documents/{doc['id']}/","faculty")
    if d.get("status")!="processing": break
    time.sleep(1)
arch=call(f"/faculty/documents/{doc['id']}/archive/","faculty","POST",{})
print("archive:", arch.get("status", arch))
out={"draft_quiz":dq["id"],"release_assignment":ha["id"],"release_result":rel,"limit_assignment":la["id"],"archived_doc":doc["id"],"held_auto_quiz":seed["held_auto_quiz"],"incident":seed["incident"],"review_doc":ids["review_doc"],"qid":ids["qid"],"aid":ids["aid"],"m1":m1}
json.dump(out, open("/tmp/r3_ids.json","w")); print(out)
