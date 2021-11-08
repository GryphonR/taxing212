# Taxing212
Browser based UK Capital Gains Calculator for Trading212: https://gryphonr.github.io/taxing212/


### What it does:
Reads in account history CSV files in the format provided by Trading 212 and provides data useful for filling in a self assessment tax return, calculated in accordance to HMRC rules. 

It does not tell you how much tax you personally owe - just calculates the figures for your self assessment tax return.

### Capital Gains Calculations

1. Groups multiple purchases or disposals on the same day into single transactions in accorcance with the same day rule.

2. Identifies same day disposals and calculates gains in accordance with the same day rule.

3. Identifies purchases within 30 days of a disposal of the same asset in accordance with the "bed and breakfast rule".

4. Remaining purchases are appointed to a Section 104 holding, and gains calculated in accordance with .

5. Shows trades and fully a commented calculation ledger for each holding.

6. Generates a round trips report for the tax year, noting the tax scheme applied to each round trip.

7. Generates a tax year summary with data required for Self Assessment Tax form.

### Dividends
Splits dividends into UK Companies, UK Other and Non-UK, sums taxes paid on non-UK dividends and provides a tax year summary.

### Privacy
All calculations are done locally in your browser, no data is uploaded to a server, no cookies are used and there are no analytics running.

All code is open source on github for verifying the above statement.

### Disclaimer
These calculations may only be used for tax purposes after they has been checked for accuracy and completeness by yourself or your tax advisor.

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
